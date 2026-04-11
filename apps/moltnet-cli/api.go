package main

import (
	"context"
	"fmt"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/ogen-go/ogen/ogenerrors"
)

// tokenSecuritySource implements moltnetapi.SecuritySource using a TokenManager.
// It provides Bearer tokens obtained via OAuth2 client_credentials flow.
//
// The API now declares three security alternatives per operation (BearerAuth,
// SessionAuth, CookieAuth). The CLI only supports OAuth2 client_credentials,
// so CookieAuth and SessionAuth return ogenerrors.ErrSkipClientSecurity —
// ogen's documented signal to skip an alternative without mutating the
// request. Because ogen calls every source method and then checks whether
// ANY security requirement is satisfied (OR across alternatives), returning
// ErrSkipClientSecurity is order-independent: only the BearerAuth method
// actually sets a header, so the final request always carries exactly one
// credential regardless of how the generator lists the alternatives.
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

// CookieAuth is not used by the CLI — it authenticates with OAuth2 bearer
// tokens only. Returning ErrSkipClientSecurity tells ogen's security picker
// to skip this alternative without touching the request.
func (s *tokenSecuritySource) CookieAuth(_ context.Context, _ moltnetapi.OperationName) (moltnetapi.CookieAuth, error) {
	return moltnetapi.CookieAuth{}, ogenerrors.ErrSkipClientSecurity
}

// SessionAuth is not used by the CLI — it authenticates with OAuth2 bearer
// tokens only. Returning ErrSkipClientSecurity tells ogen's security picker
// to skip this alternative without touching the request.
func (s *tokenSecuritySource) SessionAuth(_ context.Context, _ moltnetapi.OperationName) (moltnetapi.SessionAuth, error) {
	return moltnetapi.SessionAuth{}, ogenerrors.ErrSkipClientSecurity
}

// newAuthedClient builds a moltnetapi.Client authenticated via the TokenManager.
// The underlying HTTP client uses a retry transport: 429 on all methods,
// 408/5xx on idempotent methods only (GET, HEAD, OPTIONS, PUT).
func newAuthedClient(apiURL string, tm *TokenManager) (*moltnetapi.Client, error) {
	return moltnetapi.NewClient(
		strings.TrimRight(apiURL, "/"),
		&tokenSecuritySource{tm: tm},
		moltnetapi.WithClient(tm.httpClient),
	)
}

// newClientFromCreds loads stored credentials, creates a TokenManager, and
// returns a fully authenticated moltnetapi.Client.
// If credPath is non-empty, credentials are loaded from that path;
// otherwise, the default auto-discovery is used.
func newClientFromCreds(apiURL, credPath string) (*moltnetapi.Client, error) {
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
