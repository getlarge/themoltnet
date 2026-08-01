package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// RegisterRequest is the POST body for /auth/register.
type RegisterRequest struct {
	PublicKey   string `json:"public_key"`
	VoucherCode string `json:"voucher_code"`
}

// RegisterResponse is the success body from /auth/register.
type RegisterResponse struct {
	IdentityID   string `json:"identityId"`
	Fingerprint  string `json:"fingerprint"`
	PublicKey    string `json:"publicKey"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// ProblemDetails is the RFC 9457 error shape.
type ProblemDetails struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// RegisterResult holds everything needed after registration.
type RegisterResult struct {
	KeyPair  *KeyPair
	Response *RegisterResponse
	APIUrl   string
}

// DoRegister generates a keypair and registers with the API.
func DoRegister(apiURL string, voucherCode string) (*RegisterResult, error) {
	kp, err := GenerateKeyPair()
	if err != nil {
		return nil, err
	}

	reqBody := RegisterRequest{
		PublicKey:   kp.PublicKey,
		VoucherCode: voucherCode,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	reqURL := apiURL + "/auth/register"
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(reqURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", formatTransportError(err))
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", formatTransportError(err))
	}

	if resp.StatusCode != http.StatusOK {
		var problem ProblemDetails
		if err := json.Unmarshal(respBody, &problem); err != nil {
			return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
		}
		detail := problem.Title
		if problem.Detail != "" {
			detail = problem.Title + ": " + problem.Detail
		}
		return nil, fmt.Errorf("registration failed (HTTP %d): %s", resp.StatusCode, detail)
	}

	var regResp RegisterResponse
	if err := json.Unmarshal(respBody, &regResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	return &RegisterResult{
		KeyPair:  kp,
		Response: &regResp,
		APIUrl:   apiURL,
	}, nil
}

// runRegisterCmd registers a new agent identity with the given parameters.
func runRegisterCmd(apiURL, voucher string, jsonOut, noMCP bool) error {
	url := strings.TrimRight(apiURL, "/")
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

	fmt.Fprintf(os.Stderr, "Generating Ed25519 keypair...\n")
	result, err := DoRegister(url, voucher)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "Registered as %s (fingerprint: %s)\n",
		result.Response.IdentityID, result.KeyPair.Fingerprint)

	if jsonOut {
		return outputJSON(result)
	}

	secretRef := SecretReference{
		Provider: osKeyringProviderName,
		Key: OAuth2SecretKey(
			result.Response.IdentityID,
			result.Response.ClientID,
		),
	}
	if err := (OSKeyringSecretProvider{}).Set(
		secretRef.Key,
		result.Response.ClientSecret,
	); err != nil {
		return fmt.Errorf(
			"store OAuth2 secret in the OS keyring: %w (registration succeeded; re-run with --json only if an explicit recovery copy is required)",
			err,
		)
	}

	// Write credentials
	credPath, err := WriteConfig(&CredentialsFile{
		IdentityID: result.Response.IdentityID,
		OAuth2: CredentialsOAuth2{
			ClientID:        result.Response.ClientID,
			ClientSecretRef: &secretRef,
		},
		Keys: CredentialsKeys{
			PublicKey:   result.KeyPair.PublicKey,
			PrivateKey:  result.KeyPair.PrivateKey,
			Fingerprint: result.KeyPair.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{
			API: result.APIUrl,
			MCP: deriveMCPURL(url),
		},
		RegisteredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		if cleanupErr := (OSKeyringSecretProvider{}).Delete(secretRef.Key); cleanupErr != nil {
			return fmt.Errorf(
				"credentials could not be written and the keyring entry %s could not be removed: %v (original error: %w)",
				secretRef.Key,
				cleanupErr,
				err,
			)
		}
		return fmt.Errorf(
			"credentials could not be written; the new keyring entry was removed: %w",
			err,
		)
	}
	fmt.Fprintf(os.Stderr, "Credentials written to %s\n", credPath)

	// Generic MCP config files have no portable syntax for keyring references.
	// LeGreffier setup writes client-specific env references that are populated
	// by `moltnet start` at launch time.
	if !noMCP {
		fmt.Fprintln(os.Stderr, "MCP config not written: run 'legreffier setup' to create a credential-safe client configuration")
	}

	return nil
}

func outputJSON(result *RegisterResult) error {
	out := map[string]interface{}{
		"identity_id":   result.Response.IdentityID,
		"fingerprint":   result.KeyPair.Fingerprint,
		"public_key":    result.KeyPair.PublicKey,
		"private_key":   result.KeyPair.PrivateKey,
		"client_id":     result.Response.ClientID,
		"client_secret": result.Response.ClientSecret,
		"api_url":       result.APIUrl,
		"mcp_url":       deriveMCPURL(result.APIUrl),
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}
