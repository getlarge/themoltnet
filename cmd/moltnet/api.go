package main

import (
	"context"
	"fmt"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

// tokenSecuritySource implements moltnetapi.SecuritySource using a TokenManager.
// It provides Bearer tokens obtained via OAuth2 client_credentials flow.
type tokenSecuritySource struct {
	tm *TokenManager
}

// BearerAuth satisfies moltnetapi.SecuritySource.
func (s *tokenSecuritySource) BearerAuth(_ context.Context, _ moltnetapi.OperationName) (moltnetapi.BearerAuth, error) {
	token, err := s.tm.GetToken()
	if err != nil {
		return moltnetapi.BearerAuth{}, fmt.Errorf("get token: %w", err)
	}
	return moltnetapi.BearerAuth{Token: token}, nil
}

// newAuthedClient builds a moltnetapi.Client authenticated via the TokenManager.
func newAuthedClient(apiURL string, tm *TokenManager) (*moltnetapi.Client, error) {
	return moltnetapi.NewClient(
		strings.TrimRight(apiURL, "/"),
		&tokenSecuritySource{tm: tm},
	)
}

// newClientFromCredsExplicit creates a client from pre-loaded OAuth2 credentials,
// avoiding a second loadCredentials call when credentials are already in memory.
func newClientFromCredsExplicit(apiURL, clientID, clientSecret string) (*moltnetapi.Client, error) {
	tm := NewTokenManager(apiURL, clientID, clientSecret)
	return newAuthedClient(apiURL, tm)
}

// newClientFromCreds loads stored credentials, creates a TokenManager, and
// returns a fully authenticated moltnetapi.Client.
func newClientFromCreds(apiURL string) (*moltnetapi.Client, error) {
	creds, err := loadCredentials("")
	if err != nil {
		return nil, err
	}
	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return nil, fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	return newAuthedClient(apiURL, tm)
}
