package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
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
	requestID uuid.UUID
	message   string
	nonce     uuid.UUID
	gotSig    string
}

func (h *stubSigningHandler) GetSigningRequest(_ context.Context, params moltnetapi.GetSigningRequestParams) (moltnetapi.GetSigningRequestRes, error) {
	signingBytes := BuildSigningBytes(h.message, h.nonce.String())
	signingInput := base64.StdEncoding.EncodeToString(signingBytes)
	return &moltnetapi.SigningRequest{
		ID:           h.requestID,
		Message:      h.message,
		Nonce:        h.nonce,
		SigningInput: signingInput,
		Status:       moltnetapi.SigningRequestStatusPending,
		AgentId:      uuid.New(),
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(5 * time.Minute),
	}, nil
}

func (h *stubSigningHandler) SubmitSignature(_ context.Context, req *moltnetapi.SubmitSignatureReq, params moltnetapi.SubmitSignatureParams) (moltnetapi.SubmitSignatureRes, error) {
	h.gotSig = req.Signature
	return &moltnetapi.SigningRequest{
		ID:        params.ID,
		Message:   h.message,
		Nonce:     h.nonce,
		Status:    moltnetapi.SigningRequestStatusCompleted,
		AgentId:   uuid.New(),
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(5 * time.Minute),
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
		requestID: reqID,
		message:   "hello from test",
		nonce:     nonceID,
	}

	_, _, client := newTestServer(t, handler)

	// Act
	sig, err := signWithRequestID(client, reqID.String(), kp.PrivateKey)
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
