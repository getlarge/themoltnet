package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	KeyPair      *KeyPair
	Response     *RegisterResponse
	APIUrl       string
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

	url := apiURL + "/auth/register"
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
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
