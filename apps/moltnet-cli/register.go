package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
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

// DoRegister generates a keypair and self-registers an identity. Team
// membership is managed separately through `moltnet teams join` after the
// registration credential has been stored.
func DoRegister(apiURL, credentialType string) (*RegisterResult, error) {
	if credentialType != credentialTypeOAuth2 && credentialType != credentialTypeAgentKey {
		return nil, fmt.Errorf("credential type must be oauth2 or agent_key")
	}
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
	if credentialType != credentialTypeOAuth2 && credentialType != credentialTypeAgentKey {
		return nil, fmt.Errorf("credential type must be oauth2 or agent_key")
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

func runRegisterCmd(stdout, errOut io.Writer, apiURL, credentialType string, jsonOut, noMCP bool) error {
	return runRegisterCmdWithName(stdout, errOut, apiURL, credentialType, jsonOut, noMCP, "default")
}

type registerOpts struct {
	stdout, errOut  io.Writer
	apiURL          string
	credentialType  string
	name            string
	destination     string
	jsonOut, noMCP  bool
	secretProviders *SecretProviderRegistry
}

func runRegisterCmdWithName(stdout, errOut io.Writer, apiURL, credentialType string, jsonOut, noMCP bool, name string) error {
	return runRegister(registerOpts{
		stdout: stdout, errOut: errOut, apiURL: apiURL, credentialType: credentialType,
		jsonOut: jsonOut, noMCP: noMCP, name: name,
	})
}

// preflightSecretDestination proves the provider can store and remove a value
// before any remote identity exists, so a missing keyring fails here.
func preflightSecretDestination(registry *SecretProviderRegistry, destination string) error {
	ref := SecretReference{
		Provider: destination,
		Key:      fmt.Sprintf("preflight/%d/%d", os.Getpid(), time.Now().UnixNano()),
	}
	if err := registry.Store(ref, "credential-store-preflight"); err != nil {
		return err
	}
	return registry.Delete(ref)
}

func runRegister(opts registerOpts) error {
	url := strings.TrimRight(opts.apiURL, "/")
	if !opts.jsonOut {
		if strings.TrimSpace(opts.name) == "" {
			return fmt.Errorf("--name is required unless --json is used")
		}
		if err := validateAgentName(opts.name); err != nil {
			return err
		}
	}
	if opts.credentialType == credentialTypeAgentKey && !opts.jsonOut {
		return fmt.Errorf("agent_key bootstrap credentials are one-time secrets; use --json and store the result securely")
	}
	if opts.jsonOut {
		fmt.Fprintln(opts.errOut, "Generating Ed25519 keypair...")
		result, err := DoRegister(url, opts.credentialType)
		if err != nil {
			return err
		}
		fmt.Fprintf(opts.errOut, "Registered as %s (fingerprint: %s)\n", result.Response.SubjectID, result.KeyPair.Fingerprint)
		return outputJSON(opts.stdout, result)
	}

	registry := opts.secretProviders
	if registry == nil {
		registry = NewSecretProviderRegistry()
	}
	destination, err := validateMigrationDestination(registry, opts.destination)
	if err != nil {
		return fmt.Errorf("registration was not attempted: %w", err)
	}
	if err := preflightSecretDestination(registry, destination); err != nil {
		return fmt.Errorf("secret provider %q is unavailable; registration was not attempted: %w", destination, err)
	}
	credPath, err := identityCredentialsPath(opts.name)
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(credPath); statErr == nil {
		return fmt.Errorf("identity %q already exists at %s; choose another --name or remove it first", opts.name, credPath)
	}

	fmt.Fprintln(opts.errOut, "Generating Ed25519 keypair...")
	kp, err := GenerateKeyPair()
	if err != nil {
		return err
	}
	// The seed is durable before the network call so a failure after the
	// server commits can never lose the keypair.
	seedRef := SecretReference{Provider: destination, Key: IdentitySeedKey(kp.Fingerprint)}
	if err := registry.Store(seedRef, kp.PrivateKey); err != nil {
		return fmt.Errorf("store identity seed in %s; registration was not attempted: %w", destination, err)
	}

	result, err := DoRegisterWithKeyPair(url, opts.credentialType, kp)
	if err != nil {
		_ = registry.Delete(seedRef)
		return err
	}
	fmt.Fprintf(opts.errOut, "Registered as %s (fingerprint: %s)\n", result.Response.SubjectID, result.KeyPair.Fingerprint)

	credential := result.Response.Credential
	secretRef := SecretReference{
		Provider: destination,
		Key:      OAuth2SecretKey(result.Response.SubjectID, credential.ClientID),
	}
	// The config carries both references before the OAuth2 secret exists.
	// From here on `moltnet agents credentials recover --yes` can replace a
	// missing secret, so nothing below may delete the seed or the config.
	credPath, err = writeCentralIdentityConfig(opts.name, &CredentialsFile{
		SubjectID:    result.Response.SubjectID,
		SubjectType:  result.Response.SubjectType,
		OAuth2:       CredentialsOAuth2{ClientID: credential.ClientID, ClientSecretRef: &secretRef},
		Keys:         CredentialsKeys{PublicKey: kp.PublicKey, PrivateKeyRef: &seedRef, Fingerprint: kp.Fingerprint},
		Endpoints:    CredentialsEndpoints{API: result.APIUrl, MCP: deriveMCPURL(url)},
		RegisteredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return fmt.Errorf(
			"the agent %s (fingerprint %s) is registered and its seed is stored under %s:%s, but the credentials file could not be written: %w",
			result.Response.SubjectID, kp.Fingerprint, seedRef.Provider, seedRef.Key, err,
		)
	}
	if err := registry.Store(secretRef, credential.ClientSecret); err != nil {
		fmt.Fprintf(opts.errOut, "Credentials written to %s\n", credPath)
		return fmt.Errorf(
			"store OAuth2 secret in %s: %w\nThe identity is registered and its config is written. Replace the secret with: MOLTNET_ACTIVE_IDENTITY=%s moltnet agents credentials recover --yes",
			destination, err, opts.name,
		)
	}
	fmt.Fprintf(opts.errOut, "Credentials written to %s\n", credPath)
	reportRegistrationStored(opts.errOut, result.APIUrl, credPath, opts.name, opts.noMCP)
	return nil
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
