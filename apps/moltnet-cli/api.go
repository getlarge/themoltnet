package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/ogen-go/ogen/ogenerrors"
)

const agentKeyEnv = "MOLTNET_AGENT_KEY"

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

// newAuthedClient builds a moltnetapi.Client authenticated via the TokenManager.
// The underlying HTTP client uses a retry transport: 429 on all methods,
// 408/5xx on idempotent methods only (GET, HEAD, OPTIONS, PUT).
func newAuthedClient(apiURL string, tm *TokenManager) (*moltnetapi.Client, error) {
	return newBearerClient(
		apiURL,
		func(_ context.Context) (string, error) {
			return tm.GetToken()
		},
		tm.httpClient,
	)
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
// A non-blank MOLTNET_AGENT_KEY is authoritative: it is sent directly as a
// static bearer credential and OAuth2 is never attempted as a fallback. This
// lets API-only commands run without moltnet.json. When the variable is absent
// or blank, the existing OAuth2 client_credentials flow is used.
func newAuthenticatedClient(apiURL, credPath string) (*moltnetapi.Client, error) {
	if agentKey := strings.TrimSpace(os.Getenv(agentKeyEnv)); agentKey != "" {
		return newBearerClient(
			apiURL,
			func(_ context.Context) (string, error) {
				return agentKey, nil
			},
			newAPIHTTPClient(),
		)
	}

	creds, err := loadCredentials(credPath)
	if err != nil {
		return nil, err
	}
	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return nil, fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	return newAuthedClient(apiURL, tm)
}
