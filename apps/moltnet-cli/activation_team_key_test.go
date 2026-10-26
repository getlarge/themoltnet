package main

import (
	"bytes"
	"encoding/json"
	"io"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

const otherTeamID = "00000000-0000-4000-8000-0000000000ff"

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
	var out, warnings bytes.Buffer
	if err := runAgentsActivationRefreshCmd(&out, &warnings, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	var result activationValidationResult
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Valid || result.CredentialProviders["agentKey"] != "absent" {
		t.Fatalf("unexpected activation result: %+v", result)
	}
	assertUnverifiedWarningText(t, warnings.String())
	assertSingleUnverifiedWarning(t, result.Warnings)

	// Warm validation is how activated sessions read state, so the warning
	// must survive in the cache rather than only on the refresh's stderr.
	out.Reset()
	if err := runAgentsActivationValidateCmd(&out, "test-agent", true); err != nil {
		t.Fatalf("validate: %v", err)
	}
	result = activationValidationResult{}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Valid {
		t.Fatalf("expected warm cache to stay valid: %+v", result)
	}
	assertSingleUnverifiedWarning(t, result.Warnings)

	out.Reset()
	if err := runAgentsActivationValidateCmd(&out, "test-agent", false); err != nil {
		t.Fatalf("validate text: %v", err)
	}
	assertUnverifiedWarningText(t, out.String())
}

func assertSingleUnverifiedWarning(t *testing.T, warnings []activationWarning) {
	t.Helper()
	if len(warnings) != 1 || warnings[0].Code != activationWarningDaemonUnverified {
		t.Fatalf("expected one %s warning, got %+v", activationWarningDaemonUnverified, warnings)
	}
	assertUnverifiedWarningText(t, warnings[0].Message)
}

func assertUnverifiedWarningText(t *testing.T, text string) {
	t.Helper()
	if !strings.Contains(text, daemonUnverifiedMessage) || !strings.Contains(text, fixtureTeamID) {
		t.Fatalf("expected unverified-daemon warning naming the team, got %q", text)
	}
}

// Credential resolution wraps the selection failure; the typed error must stay
// reachable so callers can tell a missing mapping from other selection errors.
func TestResolveAgentKeyKeepsMissingTeamKeyCause(t *testing.T) {
	creds := &CredentialsFile{SubjectID: fixtureSubjectID}
	creds.AgentKeyRefs = map[string]SecretReference{otherTeamID: {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, otherTeamID)}}
	_, _, err := resolveAgentKey(creds, NewSecretProviderRegistry(), fixtureTeamID)
	if !isMissingTeamAgentKey(err) {
		t.Fatalf("expected missing team key cause, got %v", err)
	}
}

func TestBuildActivationCacheKeyOnlyRejectsUnenrolledTeam(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.OAuth2 = CredentialsOAuth2{}
		mapOnlyOtherTeamKey(t, creds)
	})
	err := buildActivationCacheForTest(t)
	if !isMissingTeamAgentKey(err) || !strings.Contains(err.Error(), `--team-id "`+fixtureTeamID+`"`) {
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
	err := runAgentsActivationRefreshCmd(io.Discard, io.Discard, "test-agent", true)
	if err == nil || isMissingTeamAgentKey(err) || !strings.Contains(err.Error(), "daemon identity") {
		t.Fatalf("expected terminal daemon key resolution error, got %v", err)
	}
}

// OAuth2 tolerates only a missing mapping. Without a team context, two mapped
// keys are ambiguous and must still fail rather than skip the daemon check.
func TestBuildActivationCacheRejectsAmbiguousTeamKeysDespiteOAuth2(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	stripActivationFixtureContext(t, dir)
	rewriteActivationFixtureCredentials(t, dir, mapTwoTeamKeys)
	if err := buildActivationCacheForTest(t); err == nil || isMissingTeamAgentKey(err) {
		t.Fatalf("expected ambiguous selection to fail at the cache gate, got %v", err)
	}
}

// The daemon cross-check skips only a missing mapping, independently of the
// cache gate that normally rejects other selection errors first.
func TestVerifyIdentityRejectsAmbiguousDaemonKeyDespiteOAuth2(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	rewriteActivationFixtureCredentials(t, dir, mapTwoTeamKeys)
	credentialsPath := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent", "moltnet.json")
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := verifyIdentityAgainstServer(resolveAPIURLFromCredentials("", false, creds), credentialsPath, creds)
	if err == nil || isMissingTeamAgentKey(err) || verified != nil {
		t.Fatalf("expected terminal ambiguous daemon key error, got %v (verified %+v)", err, verified)
	}
}

func mapTwoTeamKeys(creds *CredentialsFile) {
	creds.AgentKeyRefs = map[string]SecretReference{
		fixtureTeamID: {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, fixtureTeamID)},
		otherTeamID:   {Provider: "file", Key: TeamAgentKeyKey(fixtureSubjectID, otherTeamID)},
	}
}

func buildActivationCacheForTest(t *testing.T) error {
	t.Helper()
	ctx, err := resolveActivationContext("test-agent")
	if err != nil {
		t.Fatal(err)
	}
	_, err = buildActivationCache(ctx)
	return err
}
