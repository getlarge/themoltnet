package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

const (
	credentialTypeOAuth2   = "oauth2"
	credentialTypeAgentKey = "agent_key"
)

type RegistrationCredential struct {
	Type         string `json:"type"`
	ClientID     string `json:"clientId,omitempty"`
	ClientSecret string `json:"clientSecret,omitempty"`
	AgentKeyID   string `json:"keyId,omitempty"`
	AgentKey     string `json:"secret,omitempty"`
}

type RegisterResponse struct {
	SubjectID   string                 `json:"subjectId"`
	SubjectType SubjectType            `json:"subjectType"`
	Fingerprint string                 `json:"fingerprint"`
	PublicKey   string                 `json:"publicKey"`
	Credential  RegistrationCredential `json:"credential"`
}

type RegisterResult struct {
	KeyPair  *KeyPair
	Response *RegisterResponse
	APIUrl   string
}

func newRegistrationNonce() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate idempotency key: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func buildSelfRegistrationMessage(nonce, publicKey, credentialType string) string {
	return strings.Join([]string{
		"moltnet:register:self", nonce, publicKey, credentialType,
	}, "\n")
}

func flattenRegistrationResponse(response *moltnetapi.RegisterResponse) (*RegisterResponse, error) {
	credential := RegistrationCredential{}
	if oauth, ok := response.Credential.GetOAuth2RegistrationCredential(); ok {
		credential = RegistrationCredential{
			Type: credentialTypeOAuth2, ClientID: oauth.ClientId, ClientSecret: oauth.ClientSecret,
		}
	} else if key, ok := response.Credential.GetAgentKeyRegistrationCredential(); ok {
		keyID, valid := agentKeyID(key.Key)
		if !valid {
			return nil, fmt.Errorf("registration response has an invalid agent key binding")
		}
		credential = RegistrationCredential{
			Type: credentialTypeAgentKey, AgentKeyID: keyID, AgentKey: key.Secret,
		}
	} else {
		return nil, fmt.Errorf("registration response has an unknown credential type")
	}
	return &RegisterResponse{
		SubjectID: response.AgentId.String(), SubjectType: SubjectTypeAgent,
		Fingerprint: response.Fingerprint,
		PublicKey:   response.PublicKey, Credential: credential,
	}, nil
}

func validateRegistrationCredentialType(credentialType string) error {
	if credentialType != credentialTypeOAuth2 && credentialType != credentialTypeAgentKey {
		return fmt.Errorf("unsupported credential type %q: expected oauth2 or agent_key", credentialType)
	}
	return nil
}

// DoRegister generates a keypair and self-registers an identity. Team
// membership is managed separately through `moltnet teams join` after the
// registration credential has been stored.
func DoRegister(apiURL, credentialType string) (*RegisterResult, error) {
	kp, err := GenerateKeyPair()
	if err != nil {
		return nil, err
	}
	return DoRegisterWithKeyPair(apiURL, credentialType, kp)
}

// DoRegisterWithKeyPair self-registers an identity whose keypair the caller
// already holds. The register command stores the seed before calling this so
// the keypair survives a failure after the server has committed.
func DoRegisterWithKeyPair(apiURL, credentialType string, kp *KeyPair) (*RegisterResult, error) {
	if err := validateRegistrationCredentialType(credentialType); err != nil {
		return nil, err
	}
	if kp == nil {
		return nil, fmt.Errorf("registration requires a generated keypair")
	}
	nonce, err := newRegistrationNonce()
	if err != nil {
		return nil, err
	}
	message := buildSelfRegistrationMessage(nonce, kp.PublicKey, credentialType)
	proof, err := SignRawMessage(message, kp.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("sign registration request: %w", err)
	}

	client, err := moltnetapi.NewClient(
		strings.TrimRight(apiURL, "/"),
		nil,
		moltnetapi.WithClient(newAPIHTTPClient()),
	)
	if err != nil {
		return nil, fmt.Errorf("create API client: %w", err)
	}
	request := &moltnetapi.RegisterAgentReq{
		PublicKey: kp.PublicKey, Proof: proof,
		CredentialType: moltnetapi.RegisterAgentReqCredentialType(credentialType),
	}
	params := moltnetapi.RegisterAgentParams{IdempotencyKey: nonce}
	res, callErr := client.RegisterAgent(context.Background(), request, params)
	if callErr != nil {
		// The server may have committed before the response was dropped. Replay
		// this exact signed request once with the same idempotency nonce.
		res, callErr = client.RegisterAgent(context.Background(), request, params)
	}
	if callErr != nil {
		return nil, fmt.Errorf("registration request failed: %w", formatTransportError(callErr))
	}
	apiResponse, ok := res.(*moltnetapi.RegisterResponse)
	if !ok {
		return nil, fmt.Errorf("registration failed: %w", formatAPIError(res))
	}

	response, err := flattenRegistrationResponse(apiResponse)
	if err != nil {
		return nil, err
	}
	return &RegisterResult{KeyPair: kp, Response: response, APIUrl: strings.TrimRight(apiURL, "/")}, nil
}

type registerOpts struct {
	stdout, errOut io.Writer
	apiURL         string
	credentialType string
	// name is the local identity alias; required unless jsonOut is set.
	name string
	// destination is the secret provider for the seed and OAuth2 secret.
	// Empty means the OS keyring (see resolveSecretDestination).
	destination string
	// jsonOut prints the credential pair to stdout and writes nothing locally.
	jsonOut bool
	noMCP   bool
	// secretProviders is the registry that receives the secrets. Nil means
	// the default registry (OS keyring, env, file).
	secretProviders *SecretProviderRegistry
}

// runRegisterJSON is the explicit print-only mode: nothing is stored, and the
// caller is responsible for persisting the printed private key and secret.
func runRegisterJSON(opts registerOpts) error {
	fmt.Fprintln(opts.errOut, "Generating Ed25519 keypair...")
	result, err := DoRegister(strings.TrimRight(opts.apiURL, "/"), opts.credentialType)
	if err != nil {
		return err
	}
	fmt.Fprintf(opts.errOut, "Registered as %s (fingerprint: %s)\n", result.Response.SubjectID, result.KeyPair.Fingerprint)
	return outputJSON(opts.stdout, result)
}

// runRegister creates a local identity in a recoverable order:
//
//  1. refuse an existing alias and preflight the secret provider;
//  2. generate the keypair and store the seed, before any network call;
//  3. register; the seed is kept whatever the outcome;
//  4. create the config exclusively, with the seed and OAuth2 references;
//  5. store the OAuth2 secret;
//  6. seed the default identity and publish the alias, both best effort.
//
// From step 4 on, `moltnet agents credentials recover --yes` can finish any
// failure. Before it, the error names the fingerprint and the kept seed.
func runRegister(opts registerOpts) error {
	if opts.jsonOut {
		return runRegisterJSON(opts)
	}
	if strings.TrimSpace(opts.name) == "" {
		return fmt.Errorf("--name is required unless --json is used")
	}
	if err := validateAgentName(opts.name); err != nil {
		return err
	}
	if opts.credentialType == credentialTypeAgentKey {
		return fmt.Errorf("agent_key bootstrap credentials are one-time secrets; use --json and store the result securely")
	}
	url := strings.TrimRight(opts.apiURL, "/")

	credPath, err := identityCredentialsPath(opts.name)
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(credPath); statErr == nil {
		return identityExistsError(credPath)
	}
	secrets, err := openIdentitySecretStore(opts.secretProviders, opts.destination)
	if err != nil {
		return fmt.Errorf("registration was not attempted: %w", err)
	}

	fmt.Fprintln(opts.errOut, "Generating Ed25519 keypair...")
	identity, err := secrets.prepareIdentity()
	if err != nil {
		return fmt.Errorf("registration was not attempted: %w", err)
	}

	result, err := DoRegisterWithKeyPair(url, opts.credentialType, identity.KeyPair)
	if err != nil {
		return registrationFailure(err, url, identity)
	}
	subjectID := result.Response.SubjectID
	fmt.Fprintf(opts.errOut, "Registered as %s (fingerprint: %s)\n", subjectID, identity.KeyPair.Fingerprint)

	credential := result.Response.Credential
	secretRef := secrets.ref(OAuth2SecretKey(subjectID, credential.ClientID))
	// The config carries both references before the OAuth2 secret exists, so
	// from here on the recover command can replace a missing secret.
	if err := createIdentityConfig(&CredentialsFile{
		SubjectID:    subjectID,
		SubjectType:  result.Response.SubjectType,
		OAuth2:       CredentialsOAuth2{ClientID: credential.ClientID, ClientSecretRef: &secretRef},
		Keys:         CredentialsKeys{PublicKey: identity.KeyPair.PublicKey, PrivateKeyRef: &identity.SeedRef, Fingerprint: identity.KeyPair.Fingerprint},
		Endpoints:    CredentialsEndpoints{API: result.APIUrl, MCP: deriveMCPURL(url)},
		RegisteredAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, credPath); err != nil {
		if errors.Is(err, errIdentityExists) {
			// The existing config belongs to whoever won the race, so the usual
			// "move it aside" advice does not apply to this run's agent.
			err = fmt.Errorf("identity %q was created by another command while this one registered", opts.name)
		}
		return fmt.Errorf("%w\nAgent %s is registered but has no local config (%s). Keep that seed: it is the only proof of ownership of the agent", err, subjectID, identity.seedLocation())
	}
	fmt.Fprintf(opts.errOut, "Credentials written to %s\n", credPath)

	if _, err := secrets.store(secretRef.Key, credential.ClientSecret); err != nil {
		return fmt.Errorf("%w\nAgent %s is registered and its config is written; replace the secret with: MOLTNET_ACTIVE_IDENTITY=%s moltnet agents credentials recover --yes", err, subjectID, opts.name)
	}
	// Only a warning, unlike writeCentralIdentityConfig: the agent is already
	// registered and stored, and a rerun would be refused as an existing alias,
	// so failing here would hide a usable identity behind an error.
	if err := seedIdentitySelectorIfUnset(opts.name); err != nil {
		fmt.Fprintf(opts.errOut, "Warning: %s was not selected as the default identity: %v\nSelect it with: moltnet config identity select %s\n", opts.name, err, opts.name)
	}
	reportRegistrationStored(opts.errOut, result.APIUrl, credPath, opts.name, opts.noMCP)
	return nil
}

// registrationFailure explains a registration that did not complete. The seed
// is kept either way: after a rejection it is merely unused, while any other
// failure may follow a server-side commit that only the seed can prove.
func registrationFailure(err error, apiURL string, identity *preparedIdentity) error {
	if registrationRejected(err) {
		return fmt.Errorf("%w\nThe server rejected the registration, so no agent was created (%s; that seed is unused)", err, identity.seedLocation())
	}
	return fmt.Errorf(
		"%w\nThe server may have registered this identity (%s).\nCheck with: curl -fsS %s/agents/%s\nIf the agent exists, keep that seed: it is the only proof of ownership. Running register again generates a new keypair and can create a second agent",
		err, identity.seedLocation(), apiURL, identity.KeyPair.Fingerprint,
	)
}

// registrationRejected reports a definitive refusal: any 4xx except 409, which
// the registration route returns while a registration for the same key is
// still in progress and may yet commit.
func registrationRejected(err error) bool {
	status, ok := apiErrorStatus(err)
	return ok && status >= 400 && status < 500 && status != http.StatusConflict
}

// reportRegistrationStored runs the best-effort steps after the new identity
// is stored. None of them can fail registration: the credentials exist.
func reportRegistrationStored(errOut io.Writer, apiURL, credPath, name string, noMCP bool) {
	attemptIdentityAliasPublication(errOut, apiURL, credPath, name, identityPublishTimeout)
	if !noMCP {
		fmt.Fprintln(errOut, "MCP config not written: install LeGreffier from your host's plugin directory for authenticated MCP access")
	}
}

func outputJSON(stdout io.Writer, result *RegisterResult) error {
	out := map[string]interface{}{
		"subject_id": result.Response.SubjectID, "subject_type": result.Response.SubjectType,
		"fingerprint": result.KeyPair.Fingerprint,
		"public_key":  result.KeyPair.PublicKey, "private_key": result.KeyPair.PrivateKey,
		"credential": result.Response.Credential,
		"api_url":    result.APIUrl, "mcp_url": deriveMCPURL(result.APIUrl),
	}
	return printJSONTo(stdout, out)
}
