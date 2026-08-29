package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// SignerIdentity is the non-secret identity a signer speaks for.
type SignerIdentity struct {
	AgentName   string `json:"agentName"`
	IdentityID  string `json:"identityId"`
	PublicKey   string `json:"publicKey"`
	Fingerprint string `json:"fingerprint"`
	GitName     string `json:"gitName"`
	GitEmail    string `json:"gitEmail"`
}

// Signer is the seam between key storage and every command that needs a
// signature. Operations are purpose-bound: there is no "sign bytes" method.
type Signer interface {
	Identity(ctx context.Context) (SignerIdentity, error)
	// SignDiaryEntry signs a pending agent-ed25519 signing request and returns
	// the base64 signature recorded on it.
	SignDiaryEntry(ctx context.Context, client *moltnetapi.Client, signingRequestID string) (string, error)
	// SignGitCommit signs a validated SSHSIG envelope in the git namespace and
	// returns the raw 64-byte Ed25519 signature.
	SignGitCommit(ctx context.Context, sshsig []byte) ([]byte, error)
}

// resolveSigner picks the remote broker when MOLTNET_SIGNER_URL is set and the
// local seed from credentials otherwise. A broker-backed CLI never reads a
// private key.
func resolveSigner(credPath string) (Signer, error) {
	if signerURL := strings.TrimSpace(os.Getenv(signerURLEnv)); signerURL != "" {
		return newRemoteSigner(signerURL)
	}
	creds, err := loadCredentials(credPath)
	if err != nil {
		return nil, fmt.Errorf("%w; set %s to use a host signing broker", err, signerURLEnv)
	}
	seed, err := resolveIdentitySeed(creds, NewSecretProviderRegistry())
	if err != nil {
		return nil, fmt.Errorf(
			"credentials contain an invalid Ed25519 private key: %w — run 'moltnet register' or 'moltnet config repair'",
			err,
		)
	}
	return newLocalSeedSigner(creds, seed), nil
}

// ---------------------------------------------------------------------------
// local seed signer
// ---------------------------------------------------------------------------

type localSeedSigner struct {
	creds *CredentialsFile
	seed  string
}

func newLocalSeedSigner(creds *CredentialsFile, seed string) *localSeedSigner {
	return &localSeedSigner{creds: creds, seed: seed}
}

func (s *localSeedSigner) Identity(_ context.Context) (SignerIdentity, error) {
	id := SignerIdentity{
		IdentityID:  s.creds.IdentityID,
		PublicKey:   s.creds.Keys.PublicKey,
		Fingerprint: s.creds.Keys.Fingerprint,
	}
	if s.creds.Git != nil {
		id.GitName = s.creds.Git.Name
		id.GitEmail = s.creds.Git.Email
	}
	return id, nil
}

func (s *localSeedSigner) SignDiaryEntry(ctx context.Context, client *moltnetapi.Client, signingRequestID string) (string, error) {
	rid, err := uuid.Parse(signingRequestID)
	if err != nil {
		return "", fmt.Errorf("invalid request ID %q: %w", signingRequestID, err)
	}
	req, err := fetchPendingAgentSigningRequest(ctx, client, rid)
	if err != nil {
		return "", err
	}
	rawBytes, err := base64.StdEncoding.DecodeString(req.SigningInput)
	if err != nil {
		return "", fmt.Errorf("decode signing_input: %w", formatTransportError(err))
	}
	sig, err := signRawBytes(rawBytes, s.seed)
	if err != nil {
		return "", fmt.Errorf("sign: %w", formatTransportError(err))
	}
	if _, err := client.SubmitSignature(ctx,
		&moltnetapi.SubmitSignatureReq{Signature: sig},
		moltnetapi.SubmitSignatureParams{ID: rid},
	); err != nil {
		return "", fmt.Errorf("submit signature: %w", formatTransportError(err))
	}
	return sig, nil
}

func (s *localSeedSigner) SignGitCommit(_ context.Context, sshsig []byte) ([]byte, error) {
	env, err := parseSshsigEnvelope(sshsig)
	if err != nil {
		return nil, err
	}
	if err := assertGitSshsigEnvelope(env); err != nil {
		return nil, err
	}
	seed, err := decodeEd25519Seed(s.seed)
	if err != nil {
		return nil, err
	}
	return ed25519.Sign(ed25519.NewKeyFromSeed(seed), sshsig), nil
}

func fetchPendingAgentSigningRequest(ctx context.Context, client *moltnetapi.Client, rid uuid.UUID) (*moltnetapi.SigningRequest, error) {
	res, err := client.GetSigningRequest(ctx, moltnetapi.GetSigningRequestParams{ID: rid})
	if err != nil {
		return nil, fmt.Errorf("fetch signing request: %w", formatTransportError(err))
	}
	req, ok := res.(*moltnetapi.SigningRequest)
	if !ok {
		return nil, formatAPIError(res)
	}
	if req.VerificationMethod != moltnetapi.SigningRequestVerificationMethodAgentEd25519 {
		return nil, fmt.Errorf(
			"signing request %s uses unsupported verification method %q (CLI supports only agent-ed25519)",
			rid, req.VerificationMethod,
		)
	}
	if req.Status != moltnetapi.SigningRequestStatusPending {
		return nil, fmt.Errorf("signing request %s is not pending (status: %s)", rid, req.Status)
	}
	return req, nil
}

// ---------------------------------------------------------------------------
// remote signer (host capability broker)
// ---------------------------------------------------------------------------

type remoteSigner struct {
	baseURL    string
	httpClient *http.Client
	identity   *SignerIdentity
}

// remoteSignerError carries only the broker's error code and HTTP status.
type remoteSignerError struct {
	Code   string
	Status int
}

func (e *remoteSignerError) Error() string {
	return fmt.Sprintf("remote signer %d: %s", e.Status, e.Code)
}

func newRemoteSigner(signerURL string) (*remoteSigner, error) {
	parsed, err := url.Parse(signerURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("%s must be an absolute URL, got %q", signerURLEnv, signerURL)
	}
	loopback := parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1"
	if !strings.EqualFold(parsed.Scheme, "https") && !(strings.EqualFold(parsed.Scheme, "http") && loopback) {
		return nil, fmt.Errorf("%s must use https (http is accepted for loopback fixtures only)", signerURLEnv)
	}
	return &remoteSigner{
		baseURL:    strings.TrimRight(signerURL, "/"),
		httpClient: &http.Client{Timeout: 30 * time.Second, Transport: NewRetryTransport(nil, nil)},
	}, nil
}

func (s *remoteSigner) call(ctx context.Context, method, path string, body any, out any) error {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.baseURL+path, payload)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("remote signer: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		code := "request_failed"
		var failure struct {
			Code string `json:"code"`
		}
		if json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&failure) == nil && failure.Code != "" {
			code = failure.Code
		}
		return &remoteSignerError{Code: code, Status: res.StatusCode}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(out)
}

func (s *remoteSigner) Identity(ctx context.Context) (SignerIdentity, error) {
	if s.identity != nil {
		return *s.identity, nil
	}
	var id SignerIdentity
	if err := s.call(ctx, http.MethodGet, "/identity", nil, &id); err != nil {
		return SignerIdentity{}, err
	}
	if id.PublicKey == "" || id.Fingerprint == "" {
		return SignerIdentity{}, errors.New("remote signer identity is incomplete")
	}
	s.identity = &id
	return id, nil
}

func (s *remoteSigner) SignDiaryEntry(ctx context.Context, client *moltnetapi.Client, signingRequestID string) (string, error) {
	rid, err := uuid.Parse(signingRequestID)
	if err != nil {
		return "", fmt.Errorf("invalid request ID %q: %w", signingRequestID, err)
	}
	var out struct {
		SigningRequestID string `json:"signingRequestId"`
	}
	if err := s.call(ctx, http.MethodPost, "/sign-diary-entry",
		map[string]string{"signingRequestId": rid.String()}, &out); err != nil {
		return "", err
	}
	if out.SigningRequestID != rid.String() {
		return "", fmt.Errorf("remote signer echoed request ID %q, expected %q", out.SigningRequestID, rid.String())
	}
	// The host submitted the signature; read it back and require a completed
	// request with a non-null signature before reporting success.
	res, err := client.GetSigningRequest(ctx, moltnetapi.GetSigningRequestParams{ID: rid})
	if err != nil {
		return "", fmt.Errorf("fetch signed request: %w", formatTransportError(err))
	}
	req, ok := res.(*moltnetapi.SigningRequest)
	if !ok {
		return "", formatAPIError(res)
	}
	if req.Status != moltnetapi.SigningRequestStatusCompleted || req.Signature.Null || req.Signature.Value == "" {
		return "", fmt.Errorf("remote signer did not complete signing request %s", rid)
	}
	return req.Signature.Value, nil
}

func (s *remoteSigner) SignGitCommit(ctx context.Context, sshsig []byte) ([]byte, error) {
	env, err := parseSshsigEnvelope(sshsig)
	if err == nil {
		err = assertGitSshsigEnvelope(env)
	}
	if err != nil {
		return nil, err
	}
	var out struct {
		Signature string `json:"signature"`
	}
	if err := s.call(ctx, http.MethodPost, "/sign-git-commit",
		map[string]string{"sshsig": base64.StdEncoding.EncodeToString(sshsig)}, &out); err != nil {
		return nil, err
	}
	sig, err := base64.StdEncoding.DecodeString(out.Signature)
	if err != nil {
		return nil, fmt.Errorf("decode remote signature: %w", err)
	}
	if len(sig) != ed25519.SignatureSize {
		return nil, fmt.Errorf("remote signature has %d bytes, expected %d", len(sig), ed25519.SignatureSize)
	}
	return sig, nil
}
