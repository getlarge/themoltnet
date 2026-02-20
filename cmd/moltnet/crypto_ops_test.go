package main

import (
	"context"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

type stubCryptoHandler struct {
	moltnetapi.UnimplementedHandler
}

func (h *stubCryptoHandler) GetCryptoIdentity(_ context.Context) (moltnetapi.GetCryptoIdentityRes, error) {
	return &moltnetapi.CryptoIdentity{
		Fingerprint: "A1B2-C3D4-E5F6-A1B2",
		PublicKey:   "ed25519:pk-abc",
		IdentityId:  uuid.MustParse("00000000-0000-0000-0000-000000000001"),
	}, nil
}

func (h *stubCryptoHandler) VerifyCryptoSignature(_ context.Context, req *moltnetapi.VerifyCryptoSignatureReq) (moltnetapi.VerifyCryptoSignatureRes, error) {
	return &moltnetapi.CryptoVerifyResult{Valid: req.Signature == "valid-sig"}, nil
}

func TestCryptoIdentity(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubCryptoHandler{})

	// Act
	res, err := client.GetCryptoIdentity(context.Background())

	// Assert
	if err != nil {
		t.Fatalf("GetCryptoIdentity() error: %v", err)
	}
	identity, ok := res.(*moltnetapi.CryptoIdentity)
	if !ok {
		t.Fatalf("expected *CryptoIdentity, got %T", res)
	}
	if identity.Fingerprint != "A1B2-C3D4-E5F6-A1B2" {
		t.Errorf("expected fingerprint=A1B2-C3D4-E5F6-A1B2, got %q", identity.Fingerprint)
	}
}

func TestCryptoVerify(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubCryptoHandler{})

	// Act
	res, err := client.VerifyCryptoSignature(context.Background(), &moltnetapi.VerifyCryptoSignatureReq{
		Signature: "valid-sig",
	})

	// Assert
	if err != nil {
		t.Fatalf("VerifyCryptoSignature() error: %v", err)
	}
	result, ok := res.(*moltnetapi.CryptoVerifyResult)
	if !ok {
		t.Fatalf("expected *CryptoVerifyResult, got %T", res)
	}
	if !result.Valid {
		t.Error("expected valid=true")
	}
}
