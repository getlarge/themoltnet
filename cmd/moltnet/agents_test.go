package main

import (
	"context"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

type stubAgentsHandler struct {
	moltnetapi.UnimplementedHandler
}

func (h *stubAgentsHandler) GetWhoami(_ context.Context) (moltnetapi.GetWhoamiRes, error) {
	return &moltnetapi.Whoami{
		IdentityId:  uuid.MustParse("00000000-0000-0000-0000-000000000001"),
		Fingerprint: "A1B2-C3D4-E5F6-A1B2",
		PublicKey:   "ed25519:pk-abc",
		ClientId:    "client-xyz",
	}, nil
}

func (h *stubAgentsHandler) GetAgentProfile(_ context.Context, params moltnetapi.GetAgentProfileParams) (moltnetapi.GetAgentProfileRes, error) {
	return &moltnetapi.AgentProfile{
		Fingerprint: params.Fingerprint,
		PublicKey:   "ed25519:pk-looked-up",
	}, nil
}

func TestAgentsWhoami(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubAgentsHandler{})

	// Act
	res, err := client.GetWhoami(context.Background())

	// Assert
	if err != nil {
		t.Fatalf("GetWhoami() error: %v", err)
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		t.Fatalf("expected *Whoami, got %T", res)
	}
	if whoami.Fingerprint != "A1B2-C3D4-E5F6-A1B2" {
		t.Errorf("expected fingerprint=A1B2-C3D4-E5F6-A1B2, got %q", whoami.Fingerprint)
	}
}

func TestAgentsLookup(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubAgentsHandler{})
	const fp = "A1B2-C3D4-E5F6-A1B2"

	// Act
	res, err := client.GetAgentProfile(context.Background(), moltnetapi.GetAgentProfileParams{
		Fingerprint: fp,
	})

	// Assert
	if err != nil {
		t.Fatalf("GetAgentProfile() error: %v", err)
	}
	profile, ok := res.(*moltnetapi.AgentProfile)
	if !ok {
		t.Fatalf("expected *AgentProfile, got %T", res)
	}
	if profile.Fingerprint != fp {
		t.Errorf("expected fingerprint=%s, got %q", fp, profile.Fingerprint)
	}
}
