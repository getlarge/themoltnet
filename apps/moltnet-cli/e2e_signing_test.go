//go:build e2e

package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func TestE2E_CLI_SigningRequestAgentRoundTrip(t *testing.T) {
	h := newCLIHarness(t)
	message := "E2E CLI signing request " + uuid.NewString()

	createOut, _ := h.run(t,
		"signing-requests", "create",
		"--message", message,
	)
	var created moltnetapi.SigningRequest
	decodeJSON(t, createOut, &created)
	if created.ID == uuid.Nil {
		t.Fatalf("expected non-nil request ID, got: %s", createOut)
	}
	if created.VerificationMethod != moltnetapi.SigningRequestVerificationMethodAgentEd25519 {
		t.Fatalf("verificationMethod = %q, want agent-ed25519", created.VerificationMethod)
	}
	if created.Status != moltnetapi.SigningRequestStatusPending {
		t.Fatalf("status = %q, want pending", created.Status)
	}
	if created.SigningInput == "" {
		t.Fatal("expected server-provided signingInput")
	}

	listOut, _ := h.run(t,
		"signing-requests", "list",
		"--scope", "requested",
	)
	var list moltnetapi.SigningRequestList
	decodeJSON(t, listOut, &list)
	if !containsSigningRequest(list.Items, created.ID) {
		t.Fatalf("created request %s missing from requested list", created.ID)
	}

	getOut, _ := h.run(t, "signing-requests", "get", created.ID.String())
	var fetched moltnetapi.SigningRequest
	decodeJSON(t, getOut, &fetched)
	if fetched.Message != message {
		t.Fatalf("message = %q, want %q", fetched.Message, message)
	}

	signatureOut, _ := h.run(t, "sign", "--request-id", created.ID.String())
	signature := strings.TrimSpace(signatureOut)
	decodedSignature, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		t.Fatalf("decode CLI signature: %v", err)
	}
	if len(decodedSignature) != ed25519.SignatureSize {
		t.Fatalf("signature length = %d, want %d", len(decodedSignature), ed25519.SignatureSize)
	}

	completedOut, _ := h.run(t, "signing-requests", "get", created.ID.String())
	var completed moltnetapi.SigningRequest
	decodeJSON(t, completedOut, &completed)
	if completed.Status != moltnetapi.SigningRequestStatusCompleted {
		t.Fatalf("status = %q, want completed", completed.Status)
	}
	if valid, ok := completed.Valid.Get(); !ok || !valid {
		t.Fatalf("valid = %+v, want true", completed.Valid)
	}
	if stored, ok := completed.Signature.Get(); !ok || stored != signature {
		t.Fatalf("stored signature does not match CLI output")
	}
}

func TestE2E_CLI_LegacySignRejectsDelegatedRequest(t *testing.T) {
	h := newCLIHarness(t)

	createOut, _ := h.run(t,
		"signing-requests", "create",
		"--message", "E2E delegated signing request "+uuid.NewString(),
		"--verification-method", "human-hardware-previewsign",
		"--team-id", e2ePersonalTeamID.String(),
		"--purpose", "exercise delegated CLI guard",
		"--constraint-type", "team-role",
		"--constraint-id", "owner",
	)
	var created moltnetapi.SigningRequest
	decodeJSON(t, createOut, &created)
	if created.VerificationMethod != moltnetapi.SigningRequestVerificationMethodHumanHardwarePreviewsign {
		t.Fatalf(
			"verificationMethod = %q, want human-hardware-previewsign",
			created.VerificationMethod,
		)
	}

	stdout, stderr, err := runE2ECLI(
		h.bin,
		h.creds,
		"sign",
		"--request-id",
		created.ID.String(),
	)
	if err == nil {
		t.Fatalf("expected legacy sign command to reject delegated request")
	}
	if strings.TrimSpace(stdout) != "" {
		t.Fatalf("expected empty stdout on rejection, got %q", stdout)
	}
	if !strings.Contains(stderr, "CLI supports only agent-ed25519") {
		t.Fatalf("expected actionable method error, got stderr:\n%s", stderr)
	}
}

func containsSigningRequest(items []moltnetapi.SigningRequest, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}
