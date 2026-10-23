package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

const (
	fixtureTeamID = "00000000-0000-4000-8000-000000000011"
	otherTeamID   = "00000000-0000-4000-8000-0000000000ff"
)

// mapOnlyOtherTeamKey stores and maps a key for a team the fixture location is not bound to.
func mapOnlyOtherTeamKey(t *testing.T, creds *CredentialsFile) {
	t.Helper()
	storeFixtureFileSecret(t, TeamAgentKeyKey(fixtureSubjectID, otherTeamID), "other-team-key")
	creds.AgentKeyRefs = map[string]SecretReference{otherTeamID: {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, otherTeamID)}}
}

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
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) { mapOnlyOtherTeamKey(t, creds) })
	var warnings bytes.Buffer
	previous := activationWarningWriter
	activationWarningWriter = &warnings
	t.Cleanup(func() { activationWarningWriter = previous })

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
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.OAuth2 = CredentialsOAuth2{}
		mapOnlyOtherTeamKey(t, creds)
	})
	err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true)
	// Must fail at the cache gate, before verification reaches the server.
	if !isMissingTeamAgentKey(err) || strings.Contains(err.Error(), "verify") ||
		!strings.Contains(err.Error(), `--team-id "`+fixtureTeamID+`"`) {
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

// OAuth2 tolerates only a missing mapping. Without a team context, two mapped
// keys are ambiguous and must still fail rather than skip the daemon check.
func TestActivationRefreshRejectsAmbiguousTeamKeysDespiteOAuth2(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	envPath := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent", "env")
	raw, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	var kept []string
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(line, "MOLTNET_TEAM_ID=") && !strings.HasPrefix(line, "MOLTNET_DIARY_ID=") {
			kept = append(kept, line)
		}
	}
	if err := os.WriteFile(envPath, []byte(strings.Join(kept, "\n")), 0o600); err != nil {
		t.Fatal(err)
	}
	useActivationTestLocation(t)
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.AgentKeyRefs = map[string]SecretReference{
			fixtureTeamID: {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, fixtureTeamID)},
			otherTeamID:   {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, otherTeamID)},
		}
	})
	err = runAgentsActivationRefreshCmd(io.Discard, "test-agent", true)
	if err == nil || isMissingTeamAgentKey(err) || strings.Contains(err.Error(), "verify") {
		t.Fatalf("expected ambiguous selection to fail at the cache gate, got %v", err)
	}
}
