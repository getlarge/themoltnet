package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// APIClient makes authenticated HTTP requests to the MoltNet REST API.
type APIClient struct {
	baseURL string
	tm      *TokenManager
	http    *http.Client
}

// NewAPIClient creates an APIClient that authenticates via the given TokenManager.
func NewAPIClient(baseURL string, tm *TokenManager) *APIClient {
	return &APIClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		tm:      tm,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Get performs an authenticated GET request and returns the response body.
func (c *APIClient) Get(path string) ([]byte, error) {
	return c.do(http.MethodGet, path, nil)
}

// Post performs an authenticated POST request with a JSON body and returns the response body.
func (c *APIClient) Post(path string, body interface{}) ([]byte, error) {
	return c.do(http.MethodPost, path, body)
}

// Delete performs an authenticated DELETE request.
func (c *APIClient) Delete(path string) error {
	_, err := c.do(http.MethodDelete, path, nil)
	return err
}

// Patch performs an authenticated PATCH request with a JSON body and returns the response body.
func (c *APIClient) Patch(path string, body interface{}) ([]byte, error) {
	return c.do(http.MethodPatch, path, body)
}

// do executes the HTTP request, injecting an Authorization header.
// On 401, it invalidates the cached token and retries once.
func (c *APIClient) do(method, path string, body interface{}) ([]byte, error) {
	data, err := c.doOnce(method, path, body)
	if err == nil {
		return data, nil
	}
	// Retry once on 401
	if isUnauthorized(err) {
		c.tm.Invalidate()
		return c.doOnce(method, path, body)
	}
	return nil, err
}

func (c *APIClient) doOnce(method, path string, body interface{}) ([]byte, error) {
	token, err := c.tm.GetToken()
	if err != nil {
		return nil, fmt.Errorf("get token: %w", err)
	}

	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, c.baseURL+path, reqBody) //nolint:gosec
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &apiError{status: resp.StatusCode, body: respBody}
	}
	return respBody, nil
}

// apiError carries the HTTP status code and response body for non-2xx responses.
type apiError struct {
	status int
	body   []byte
}

func (e *apiError) Error() string {
	msg := strings.TrimSpace(string(e.body))
	if msg == "" {
		return fmt.Sprintf("API error %d", e.status)
	}
	return fmt.Sprintf("API error %d: %s", e.status, msg)
}

func isUnauthorized(err error) bool {
	if e, ok := err.(*apiError); ok {
		return e.status == http.StatusUnauthorized
	}
	return false
}
