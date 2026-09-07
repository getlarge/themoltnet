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

func runRegisterCmdWithName(stdout, errOut io.Writer, apiURL, credentialType string, jsonOut, noMCP bool, name string) error {
	url := strings.TrimRight(apiURL, "/")
	if !jsonOut {
		if strings.TrimSpace(name) == "" {
			return fmt.Errorf("--name is required unless --json is used")
		}
		if err := validateAgentName(name); err != nil {
			return err
		}
	}
	if credentialType == credentialTypeAgentKey && !jsonOut {
		return fmt.Errorf("agent_key bootstrap credentials are one-time secrets; use --json and store the result securely")
	}
	if !jsonOut {
		provider := OSKeyringSecretProvider{}
		preflightKey := fmt.Sprintf("preflight/%d/%d", os.Getpid(), time.Now().UnixNano())
		if err := provider.Set(preflightKey, "credential-store-preflight"); err != nil {
			return fmt.Errorf("OS keyring is unavailable; registration was not attempted: %w", err)
		}
		if err := provider.Delete(preflightKey); err != nil {
			return fmt.Errorf("OS keyring cleanup failed; registration was not attempted: %w", err)
		}
	}

	fmt.Fprintln(errOut, "Generating Ed25519 keypair...")
	result, err := DoRegister(url, credentialType)
	if err != nil {
		return err
	}
	fmt.Fprintf(errOut, "Registered as %s (fingerprint: %s)\n", result.Response.SubjectID, result.KeyPair.Fingerprint)
	if jsonOut {
		return outputJSON(stdout, result)
	}

	credential := result.Response.Credential
	secretRef := SecretReference{
		Provider: osKeyringProviderName,
		Key:      OAuth2SecretKey(result.Response.SubjectID, credential.ClientID),
	}
	if err := (OSKeyringSecretProvider{}).Set(secretRef.Key, credential.ClientSecret); err != nil {
		return fmt.Errorf("store OAuth2 secret in the OS keyring: %w", err)
	}
	credPath, err := writeCentralIdentityConfig(name, &CredentialsFile{
		SubjectID:    result.Response.SubjectID,
		SubjectType:  result.Response.SubjectType,
		OAuth2:       CredentialsOAuth2{ClientID: credential.ClientID, ClientSecretRef: &secretRef},
		Keys:         CredentialsKeys{PublicKey: result.KeyPair.PublicKey, PrivateKey: result.KeyPair.PrivateKey, Fingerprint: result.KeyPair.Fingerprint},
		Endpoints:    CredentialsEndpoints{API: result.APIUrl, MCP: deriveMCPURL(url)},
		RegisteredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		_ = (OSKeyringSecretProvider{}).Delete(secretRef.Key)
		return fmt.Errorf("credentials could not be written; the new keyring entry was removed: %w", err)
	}
	fmt.Fprintf(errOut, "Credentials written to %s\n", credPath)
	if !noMCP {
		fmt.Fprintln(errOut, "MCP config not written: install LeGreffier from your host's plugin directory for authenticated MCP access")
	}
	return nil
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
