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

	// Write credentials
	credPath, err := WriteConfig(&CredentialsFile{
		IdentityID: result.Response.IdentityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     result.Response.ClientID,
			ClientSecret: result.Response.ClientSecret,
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
		return fmt.Errorf("write credentials: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Credentials written to %s\n", credPath)

	// Write MCP config
	if !noMCP {
		mcpURL := deriveMCPURL(url)
		mcpConfig := BuildMcpConfig(mcpURL, result.Response.ClientID, result.Response.ClientSecret)
		mcpPath, err := WriteMcpConfig(mcpConfig, "")
		if err != nil {
			return fmt.Errorf("write MCP config: %w", err)
		}
		fmt.Fprintf(os.Stderr, "MCP config written to %s\n", mcpPath)
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
