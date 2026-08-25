package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func TestRunSignWithCredentialsFile(t *testing.T) {
	// Generate a keypair for testing
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	// Write a temporary credentials file
	dir := t.TempDir()
	credPath := filepath.Join(dir, "credentials.json")
	creds := CredentialsFile{
		IdentityID: "test-identity",
		Keys: CredentialsKeys{
			PublicKey:   kp.PublicKey,
			PrivateKey:  kp.PrivateKey,
			Fingerprint: kp.Fingerprint,
		},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(credPath, data, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Load credentials from the temp file
	loaded, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read credentials: %v", err)
	}
	if loaded == nil {
		t.Fatal("credentials nil")
	}

	// Sign and verify
	message := "test message"
	nonce := "nonce-123"
	sig, err := SignForRequest(message, nonce, loaded.Keys.PrivateKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	valid, err := VerifyForRequest(message, nonce, sig, loaded.Keys.PublicKey)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !valid {
		t.Error("signature verification failed")
	}
}

func TestReadPayloadFromArgs(t *testing.T) {
	payload, err := readPayload([]string{"hello message"})
	if err != nil {
		t.Fatalf("readPayload: %v", err)
	}
	if payload != "hello message" {
		t.Errorf("got %q, want %q", payload, "hello message")
	}
}

func TestReadPayloadNoArgs(t *testing.T) {
	_, err := readPayload([]string{})
	if err == nil {
		t.Error("expected error for empty args")
	}
}

func TestLoadCredentialsMissing(t *testing.T) {
	_, err := loadCredentials(filepath.Join(t.TempDir(), "nonexistent.json"))
	if err == nil {
		t.Error("expected error for missing credentials")
	}
}

// stubSigningHandler implements GetSigningRequest and SubmitSignature for testing.
type stubSigningHandler struct {
	moltnetapi.UnimplementedHandler
	requestID          uuid.UUID
	message            string
	nonce              uuid.UUID
	verificationMethod moltnetapi.SigningRequestVerificationMethod
	gotSig             string
}

func (h *stubSigningHandler) GetSigningRequest(_ context.Context, params moltnetapi.GetSigningRequestParams) (moltnetapi.GetSigningRequestRes, error) {
	signingBytes := BuildSigningBytes(h.message, h.nonce.String())
	signingInput := base64.StdEncoding.EncodeToString(signingBytes)
	return &moltnetapi.SigningRequest{
		ID:                 h.requestID,
		Message:            h.message,
		Nonce:              h.nonce,
		SigningInput:       signingInput,
		Status:             moltnetapi.SigningRequestStatusPending,
		VerificationMethod: h.verificationMethod,
		AgentId:            uuid.New(),
		CreatedAt:          time.Now(),
		ExpiresAt:          time.Now().Add(5 * time.Minute),
	}, nil
}

func (h *stubSigningHandler) SubmitSignature(_ context.Context, req *moltnetapi.SubmitSignatureReq, params moltnetapi.SubmitSignatureParams) (moltnetapi.SubmitSignatureRes, error) {
	h.gotSig = req.Signature
	return &moltnetapi.SigningRequest{
		ID:                 params.ID,
		Message:            h.message,
		Nonce:              h.nonce,
		Status:             moltnetapi.SigningRequestStatusCompleted,
		VerificationMethod: h.verificationMethod,
		AgentId:            uuid.New(),
		CreatedAt:          time.Now(),
		ExpiresAt:          time.Now().Add(5 * time.Minute),
	}, nil
}

func TestSignWithRequestID(t *testing.T) {
	// Arrange: generate a real keypair
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	reqID := uuid.MustParse("00000000-0000-0000-0000-000000000099")
	nonceID := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000000")
	handler := &stubSigningHandler{
		requestID:          reqID,
		message:            "hello from test",
		nonce:              nonceID,
		verificationMethod: moltnetapi.SigningRequestVerificationMethodAgentEd25519,
	}

	_, _, client := newTestServer(t, handler)

	// Act
	sig, err := signWithRequestID(context.Background(), client, newLocalSeedSigner(&CredentialsFile{Keys: CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey, Fingerprint: kp.Fingerprint}}), reqID.String())
	if err != nil {
		t.Fatalf("signWithRequestID() error: %v", err)
	}

	// Assert: the returned signature matches what was submitted to the API
	if sig == "" {
		t.Fatal("signWithRequestID() returned empty signature")
	}
	if handler.gotSig == "" {
		t.Error("expected a signature to be submitted")
	}
	if sig != handler.gotSig {
		t.Errorf("returned signature doesn't match submitted\n  returned:  %s\n  submitted: %s", sig, handler.gotSig)
	}

	// Verify the submitted signature is cryptographically valid
	valid, err := VerifyForRequest(handler.message, nonceID.String(), handler.gotSig, kp.PublicKey)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !valid {
		t.Error("submitted signature failed verification")
	}
}

func TestRunSignRequestIDUsesAgentKeyWithLocalSigningCredentials(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	if _, err := WriteConfigTo(&CredentialsFile{
		IdentityID: "test-identity",
		Keys: CredentialsKeys{
			PublicKey:   kp.PublicKey,
			PrivateKey:  kp.PrivateKey,
			Fingerprint: kp.Fingerprint,
		},
	}, credPath); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	reqID := uuid.MustParse("00000000-0000-0000-0000-000000000098")
	handler := &stubSigningHandler{
		requestID:          reqID,
		message:            "agent-key authenticated signing",
		nonce:              uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001"),
		verificationMethod: moltnetapi.SigningRequestVerificationMethodAgentEd25519,
	}
	generated, err := moltnetapi.NewServer(handler, noopSecurityHandler{})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	apiSrv := httptest.NewServer(generated)
	defer apiSrv.Close()

	t.Setenv(agentKeyEnv, "agent-key-secret")
	var stdout bytes.Buffer
	err = runSignCmd(
		&stdout,
		credPath,
		apiSrv.URL,
		"",
		reqID.String(),
		nil,
	)
	if err != nil {
		t.Fatalf("runSignCmd() error: %v", err)
	}
	if stdout.String() == "" {
		t.Fatal("expected signature on stdout")
	}
	if handler.gotSig != stdout.String() {
		t.Error("submitted signature does not match stdout")
	}
}

func TestRunSignRequestIDRejectsMissingLocalSigningKey(t *testing.T) {
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	if _, err := WriteConfigTo(&CredentialsFile{
		IdentityID: "test-identity",
	}, credPath); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	t.Setenv(agentKeyEnv, "agent-key-secret")
	err := runSignCmd(
		&bytes.Buffer{},
		credPath,
		"https://api.example.com",
		"",
		uuid.NewString(),
		nil,
	)
	if err == nil {
		t.Fatal("expected missing signing key error")
	}
	if !strings.Contains(err.Error(), "invalid Ed25519 private key") ||
		!strings.Contains(err.Error(), "moltnet register") {
		t.Errorf("error = %q, want actionable signing-key diagnostic", err)
	}
}

func TestSignRawBytesRejectsInvalidSeedLength(t *testing.T) {
	_, err := signRawBytes([]byte("hello"), "")
	if err == nil {
		t.Fatal("expected invalid seed error")
	}
	if !strings.Contains(err.Error(), "must be 32 bytes") {
		t.Errorf("error = %q, want seed-length diagnostic", err)
	}
}

func TestSignWithRequestIDRejectsNonAgentVerificationMethod(t *testing.T) {
	// Arrange
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	reqID := uuid.MustParse("00000000-0000-0000-0000-000000000099")
	handler := &stubSigningHandler{
		requestID:          reqID,
		message:            "hardware request",
		nonce:              uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000000"),
		verificationMethod: moltnetapi.SigningRequestVerificationMethodHumanHardwarePreviewsign,
	}
	_, _, client := newTestServer(t, handler)

	// Act
	_, err = signWithRequestID(context.Background(), client, newLocalSeedSigner(&CredentialsFile{Keys: CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey, Fingerprint: kp.Fingerprint}}), reqID.String())

	// Assert
	if err == nil {
		t.Fatal("expected non-agent verification method to be rejected")
	}
	if handler.gotSig != "" {
		t.Error("non-agent request must not submit an Ed25519 signature")
	}
}
