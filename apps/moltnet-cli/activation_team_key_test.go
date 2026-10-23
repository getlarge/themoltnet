package main

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"testing"
)

const fixtureTeamID = "00000000-0000-4000-8000-000000000011"

func TestActivationVerifiesSelectedTeamBinding(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	config := &CredentialsFile{SubjectID: "subject", AgentKeyRefs: map[string]SecretReference{a.String(): {Provider: "file", Key: TeamAgentKeyKey("subject", a.String())}}}
	whoami := &moltnetapi.Whoami{CredentialBinding: moltnetapi.NewOptWhoamiCredentialBinding(moltnetapi.NewProvenanceGraphTeamNodeWhoamiCredentialBinding(moltnetapi.ProvenanceGraphTeamNode{BoundTeamId: a}))}
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err != nil {
		t.Fatal(err)
	}
	whoami.CredentialBinding.Value.ProvenanceGraphTeamNode.BoundTeamId = b
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err == nil {
		t.Fatal("activation accepted wrong team binding")
	}
	whoami.CredentialBinding = moltnetapi.NewOptWhoamiCredentialBinding(moltnetapi.NewProvenanceGraphIdentityNodeWhoamiCredentialBinding(moltnetapi.ProvenanceGraphIdentityNode{}))
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err == nil {
		t.Fatal("activation accepted identity grant in team slot")
	}
	config.AgentKeyRefs = nil
	config.AgentKeyRef = &SecretReference{Provider: "file", Key: AgentKeyKey("subject")}
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err != nil {
		t.Fatal("identity fallback was rejected")
	}
}

// A location bound to a team the identity joined without enrolling a key must
// still activate through OAuth2, which already takes precedence for API calls.
func TestActivationRefreshUsesOAuth2WhenSelectedTeamHasNoKey(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	other := "00000000-0000-4000-8000-0000000000ff"
	storeFixtureFileSecret(t, TeamAgentKeyKey(fixtureSubjectID, other), "other-team-key")
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.AgentKeyRefs = map[string]SecretReference{other: {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, other)}}
	})
	var warnings bytes.Buffer
	activationWarningWriter = &warnings
	t.Cleanup(func() { activationWarningWriter = nil })

	var out bytes.Buffer
	if err := runAgentsActivationRefreshCmd(&out, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	var result activationValidationResult
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Valid || result.CredentialProviders["agentKey"] != "absent" {
		t.Fatalf("unexpected activation result: %+v", result)
	}
	if !strings.Contains(warnings.String(), "daemon credential not verified") ||
		!strings.Contains(warnings.String(), fixtureTeamID) {
		t.Fatalf("missing daemon warning: %q", warnings.String())
	}
}

func TestActivationRefreshKeyOnlyRejectsUnenrolledTeam(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	other := "00000000-0000-4000-8000-0000000000ff"
	storeFixtureFileSecret(t, TeamAgentKeyKey(fixtureSubjectID, other), "other-team-key")
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.OAuth2 = CredentialsOAuth2{}
		creds.AgentKeyRefs = map[string]SecretReference{other: {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, other)}}
	})
	err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true)
	if !isMissingTeamAgentKey(err) || !strings.Contains(err.Error(), "--team-id "+fixtureTeamID) {
		t.Fatalf("expected actionable missing team key error, got %v", err)
	}
}

// Only an absent mapping is tolerated; a mapped key that fails to resolve
// stays terminal even though OAuth2 is configured.
func TestActivationRefreshRejectsUnresolvableSelectedTeamKey(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.AgentKeyRefs = map[string]SecretReference{fixtureTeamID: {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, fixtureTeamID)}}
	})
	err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true)
	if err == nil || isMissingTeamAgentKey(err) || !strings.Contains(err.Error(), "daemon identity") {
		t.Fatalf("expected terminal daemon key resolution error, got %v", err)
	}
}
