package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/ogen-go/ogen/ogenerrors"
)

type bearerTokenFunc func(context.Context) (string, error)

// bearerSecuritySource implements the CLI's single supported HTTP security
// scheme. The callback may return either an OAuth2 access token or a static
// agent-key secret.
//
// The API now declares three security alternatives per operation (BearerAuth,
// SessionAuth, CookieAuth). The CLI only supports bearer credentials, so
// CookieAuth and SessionAuth return ogenerrors.ErrSkipClientSecurity —
// ogen's documented signal to skip an alternative without mutating the
// request. Because ogen calls every source method and then checks whether
// ANY security requirement is satisfied (OR across alternatives), returning
// ErrSkipClientSecurity is order-independent: only the BearerAuth method
// actually sets a header, so the final request always carries exactly one
// credential regardless of how the generator lists the alternatives.
type bearerSecuritySource struct {
	token bearerTokenFunc
}

// BearerAuth satisfies moltnetapi.SecuritySource.
func (s *bearerSecuritySource) BearerAuth(ctx context.Context, _ moltnetapi.OperationName) (moltnetapi.BearerAuth, error) {
	token, err := s.token(ctx)
	if err != nil {
		return moltnetapi.BearerAuth{}, fmt.Errorf("get token: %w", err)
	}
	if token == "" {
		return moltnetapi.BearerAuth{}, fmt.Errorf("get token: empty bearer token")
	}
	return moltnetapi.BearerAuth{Token: token}, nil
}

// CookieAuth is not used by the CLI — it authenticates with OAuth2 bearer
// tokens or agent keys only. Returning ErrSkipClientSecurity tells ogen's security picker
// to skip this alternative without touching the request.
func (s *bearerSecuritySource) CookieAuth(_ context.Context, _ moltnetapi.OperationName) (moltnetapi.CookieAuth, error) {
	return moltnetapi.CookieAuth{}, ogenerrors.ErrSkipClientSecurity
}

// SessionAuth is not used by the CLI — it authenticates with OAuth2 bearer
// tokens or agent keys only. Returning ErrSkipClientSecurity tells ogen's security picker
// to skip this alternative without touching the request.
func (s *bearerSecuritySource) SessionAuth(_ context.Context, _ moltnetapi.OperationName) (moltnetapi.SessionAuth, error) {
	return moltnetapi.SessionAuth{}, ogenerrors.ErrSkipClientSecurity
}

// newBearerClient builds a generated client around one bearer-token callback.
// The callback keeps credential resolution out of the generated API client and
// lets OAuth2 and static agent keys share the same ogen security adapter.
func newBearerClient(
	apiURL string,
	token bearerTokenFunc,
	httpClient *http.Client,
) (*moltnetapi.Client, error) {
	return moltnetapi.NewClient(
		strings.TrimRight(apiURL, "/"),
		&bearerSecuritySource{token: token},
		moltnetapi.WithClient(httpClient),
	)
}

// newAuthenticatedClient resolves the CLI authentication mode and returns a
// fully authenticated generated client.
//
// OAuth2 is authoritative whenever the selected credentials document declares
// any OAuth2 material. Agent keys remain a secondary path for daemon-projected
// and intentionally key-only environments, but are considered only when OAuth2
// is entirely absent. A broken or rejected OAuth2 credential never falls back
// to an agent key and therefore cannot silently change the active grant.
func newAuthenticatedClient(apiURL, credPath string) (*moltnetapi.Client, error) {
	creds, configErr := loadCredentials(credPath)
	if configErr == nil && hasOAuth2Configuration(creds) {
		client, err := newOAuth2AuthenticatedClient(apiURL, creds, NewSecretProviderRegistry())
		if err != nil {
			return nil, fmt.Errorf("OAuth2 credentials unavailable: %w", err)
		}
		return client, nil
	}
	if configErr != nil && !errors.Is(configErr, errCredentialsNotFound) {
		return nil, fmt.Errorf("OAuth2 credentials unavailable: %w", configErr)
	}

	agentKey := strings.TrimSpace(os.Getenv(agentKeyEnv))
	agentKeyRef := strings.TrimSpace(os.Getenv(agentKeyRefEnv))
	if agentKey != "" && agentKeyRef != "" {
		return nil, fmt.Errorf("set only one of %s or %s", agentKeyEnv, agentKeyRefEnv)
	}
	if agentKeyRef != "" {
		resolved, err := resolveEnvSecretReference(agentKeyRef, NewSecretProviderRegistry())
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", agentKeyRefEnv, err)
		}
		agentKey = resolved
	}
	if agentKey != "" {
		return newAgentKeyAuthenticatedClient(apiURL, agentKey)
	}

	if configErr != nil {
		return nil, fmt.Errorf(
			"OAuth2 credentials unavailable: %w; set %s for key-only authentication",
			configErr,
			agentKeyEnv,
		)
	}
	configKey, configured, err := resolveAgentKey(creds, NewSecretProviderRegistry())
	if configured {
		if err != nil {
			return nil, fmt.Errorf("resolve agent_key_ref: %w", err)
		}
		return newAgentKeyAuthenticatedClient(apiURL, configKey)
	}
	return nil, fmt.Errorf(
		"credentials missing OAuth2 client credentials and agent_key_ref; run 'moltnet register' or set %s for key-only authentication",
		agentKeyEnv,
	)
}

// newConfigAuthenticatedClient authenticates with the credential declared by
// one exact config document. Unlike newAuthenticatedClient it deliberately
// ignores process-wide MOLTNET_AGENT_KEY overrides: config migration must prove
// which subject the document itself belongs to, not which subject happens to
// be active in the caller's environment.
func newConfigAuthenticatedClient(apiURL, credPath string, registry *SecretProviderRegistry) (*moltnetapi.Client, error) {
	creds, err := loadCredentials(credPath)
	if err != nil {
		return nil, fmt.Errorf("load credentials for authentication: %w", err)
	}
	if hasOAuth2Configuration(creds) {
		return newOAuth2AuthenticatedClient(apiURL, creds, registry)
	}
	if configKey, configured, err := resolveAgentKey(creds, registry); configured {
		if err != nil {
			return nil, fmt.Errorf("resolve agent_key_ref: %w", err)
		}
		return newAgentKeyAuthenticatedClient(apiURL, configKey)
	}
	return nil, fmt.Errorf("credentials missing OAuth2 client credentials and agent_key_ref")
}

func hasOAuth2Configuration(creds *CredentialsFile) bool {
	return creds != nil && (strings.TrimSpace(creds.OAuth2.ClientID) != "" ||
		strings.TrimSpace(creds.OAuth2.ClientSecret) != "" || creds.OAuth2.ClientSecretRef != nil)
}

func newOAuth2AuthenticatedClient(apiURL string, creds *CredentialsFile, registry *SecretProviderRegistry) (*moltnetapi.Client, error) {
	if strings.TrimSpace(creds.OAuth2.ClientID) == "" {
		return nil, fmt.Errorf("OAuth2 credentials missing client_id")
	}
	clientSecret, err := resolveOAuth2Secret(creds, registry)
	if err != nil {
		return nil, fmt.Errorf("resolve OAuth2 client secret: %w", err)
	}
	tm := NewTokenManager(apiURL, creds.OAuth2.ClientID, clientSecret)
	return newBearerClient(
		apiURL,
		func(_ context.Context) (string, error) { return tm.GetToken() },
		tm.httpClient,
	)
}

func newAgentKeyAuthenticatedClient(apiURL, agentKey string) (*moltnetapi.Client, error) {
	if err := validateAgentKeyAPIURL(apiURL); err != nil {
		return nil, err
	}
	return newBearerClient(
		apiURL,
		func(_ context.Context) (string, error) { return agentKey, nil },
		newAPIHTTPClient(),
	)
}

// validateAgentKeyAPIURL prevents a long-lived agent key from being sent over
// plaintext transport. HTTP remains available for local development and e2e
// stacks on loopback only.
func validateAgentKeyAPIURL(apiURL string) error {
	parsed, err := url.Parse(apiURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf(
			"%s requires an absolute API URL, got %q",
			agentKeyEnv,
			apiURL,
		)
	}
	if strings.EqualFold(parsed.Scheme, "https") {
		return nil
	}
	if strings.EqualFold(parsed.Scheme, "http") {
		host := parsed.Hostname()
		if strings.EqualFold(host, "localhost") {
			return nil
		}
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			return nil
		}
	}
	return fmt.Errorf(
		"%s refuses to send an agent key to insecure API URL %q; use HTTPS or an HTTP loopback address",
		agentKeyEnv,
		apiURL,
	)
}
