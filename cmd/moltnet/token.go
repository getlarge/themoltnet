package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// TokenManager obtains and caches an OAuth2 client_credentials token.
type TokenManager struct {
	apiURL             string
	clientID           string
	clientSecret       string
	earlyExpirySeconds int
	httpClient         *http.Client

	mu        sync.Mutex
	cached    string
	expiresAt time.Time
}

// NewTokenManager creates a TokenManager with a 30-second early-expiry buffer.
func NewTokenManager(apiURL, clientID, clientSecret string) *TokenManager {
	return &TokenManager{
		apiURL:             apiURL,
		clientID:           clientID,
		clientSecret:       clientSecret,
		earlyExpirySeconds: 30,
		httpClient:         &http.Client{Timeout: 30 * time.Second},
	}
}

// GetToken returns a cached token if still valid, or fetches a fresh one.
func (t *TokenManager) GetToken() (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cached != "" && time.Now().Before(t.expiresAt) {
		return t.cached, nil
	}
	return t.fetchToken()
}

// Invalidate clears the cached token, forcing the next GetToken call to fetch a new one.
// Call this when a request returns HTTP 401.
func (t *TokenManager) Invalidate() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.cached = ""
	t.expiresAt = time.Time{}
}

// fetchToken performs the OAuth2 client_credentials grant and updates the cache.
// Must be called with t.mu held.
func (t *TokenManager) fetchToken() (string, error) {
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", t.clientID)
	form.Set("client_secret", t.clientSecret)
	form.Set("scope", "openid")

	resp, err := t.httpClient.Post( //nolint:gosec
		t.apiURL+"/oauth2/token",
		"application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return "", fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint returned HTTP %d", resp.StatusCode)
	}

	var payload struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}
	if payload.AccessToken == "" {
		return "", fmt.Errorf("token response contained empty access_token")
	}

	ttl := time.Duration(payload.ExpiresIn-t.earlyExpirySeconds) * time.Second
	t.cached = payload.AccessToken
	if ttl <= 0 {
		// Token lifetime is shorter than the early expiry buffer — do not cache;
		// set expiresAt to now so the next call always fetches a fresh token.
		t.expiresAt = time.Now()
	} else {
		t.expiresAt = time.Now().Add(ttl)
	}

	return t.cached, nil
}
