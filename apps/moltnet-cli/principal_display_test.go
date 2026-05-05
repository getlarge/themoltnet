package main

import (
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func TestFormatPrincipalDisplay_Agent(t *testing.T) {
	agent := moltnetapi.AgentPrincipal{
		Fingerprint: "A1B2-C3D4-E5F6-G7H8",
		IdentityId:  uuid.MustParse("11111111-1111-4111-b111-111111111111"),
		PublicKey:   "ed25519:AAAA",
	}
	got := formatPrincipalDisplay(agent, true, moltnetapi.HumanPrincipal{}, false)
	want := "agent:A1B2-C3D4-E5F6-G7H8"
	if got != want {
		t.Fatalf("agent path: got %q, want %q", got, want)
	}
}

func TestFormatPrincipalDisplay_Human(t *testing.T) {
	humanID := uuid.MustParse("22222222-2222-4222-b222-222222222222")
	human := moltnetapi.HumanPrincipal{HumanId: humanID}
	got := formatPrincipalDisplay(moltnetapi.AgentPrincipal{}, false, human, true)
	want := "human:22222222"
	if got != want {
		t.Fatalf("human path: got %q, want %q", got, want)
	}
}

func TestFormatPrincipalDisplay_Unknown(t *testing.T) {
	got := formatPrincipalDisplay(moltnetapi.AgentPrincipal{}, false, moltnetapi.HumanPrincipal{}, false)
	if got != "unknown" {
		t.Fatalf("unknown path: got %q, want %q", got, "unknown")
	}
}
