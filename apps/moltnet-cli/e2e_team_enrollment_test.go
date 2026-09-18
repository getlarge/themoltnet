//go:build e2e

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestE2E_CLI_TeamEnrollmentStorageAndIndependentRotation(t *testing.T) {
	h := newCLIHarness(t)
	for _, name := range []string{agentKeyEnv, agentKeyRefEnv, "MOLTNET_TEAM_ID", "MOLTNET_CREDENTIALS_PATH", "MOLTNET_CLIENT_ID", "MOLTNET_CLIENT_SECRET"} {
		t.Setenv(name, "")
	}
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	t.Setenv(secretRootWritableEnv, "1")
	provider := FileSecretProvider{Root: root, Writable: true}
	config := *e2eCreds
	config.SubjectID = e2eAgentID
	config.SubjectType = SubjectTypeAgent
	configPath := filepath.Join(t.TempDir(), "moltnet.json")
	if _, err := WriteConfigTo(&config, configPath); err != nil {
		t.Fatal(err)
	}
	invitation := func() (string, string) {
		out, _ := h.run(t, "teams", "create", "--name", "cli-enrollment-"+uuid.NewString())
		var team struct {
			ID string `json:"id"`
		}
		decodeJSON(t, out, &team)
		out, _ = h.run(t, "teams", "invite", "create", team.ID, "--role", "member")
		var invite struct {
			Code string `json:"code"`
		}
		decodeJSON(t, out, &invite)
		return team.ID, invite.Code
	}
	enroll := func(code, idempotency string) (string, string, error) {
		return runE2ECLI(h.bin, configPath, "teams", "join", "--code", code, "--issue-agent-key", "--store", "--destination", "file", "--idempotency-key", idempotency)
	}
	a, codeA := invitation()
	b, codeB := invitation()
	idemA := uuid.NewString()
	out, stderr, err := enroll(codeA, idemA)
	if err != nil {
		t.Fatalf("enroll A: %v %s", err, stderr)
	}
	var first storedAgentKeyOutput
	decodeJSON(t, out, &first)
	secretA, err := provider.Get(first.AgentKeyRef.Key)
	if err != nil {
		t.Fatal(err)
	}
	if first.TeamID != a || !first.CredentialsUpdated || strings.Contains(out+stderr, secretA) {
		t.Fatal("bad stored enrollment result")
	}
	out, stderr, err = enroll(codeB, uuid.NewString())
	if err != nil {
		t.Fatalf("enroll B: %v %s", err, stderr)
	}
	var second storedAgentKeyOutput
	decodeJSON(t, out, &second)
	secretB, err := provider.Get(second.AgentKeyRef.Key)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out+stderr, secretB) {
		t.Fatal("B secret was printed")
	}
	saved, err := ReadConfigFrom(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.AgentKeyRefs) != 2 || saved.AgentKeyRef != nil {
		t.Fatal("enrollment did not keep independent team slots")
	}
	before, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	// The replay never reaches the server. `teams join --store` records that
	// this idempotency key already minted a key whose secret cannot be read
	// back, and refuses locally rather than risk issuing a second unrecoverable
	// credential. Asserting an HTTP 409 described the behaviour from before that
	// guard existed, when the request was sent and the server rejected the
	// repeated key.
	if _, stderr, err := enroll(codeA, idemA); err == nil ||
		!strings.Contains(stderr, "enrollment already issued key") {
		t.Fatalf("replay must be refused before contacting the server: %v %s", err, stderr)
	}
	after, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("replay changed credential storage")
	}
	// The management credential rotates only A's slot; B remains byte-identical.
	teamKey, _ := first.Key.GetTeamAgentKey()
	out, stderr, err = runE2ECLI(h.bin, configPath, "agents", "keys", "rotate", teamKey.ID, "--team-id", a, "--store", "--destination", "file")
	if err != nil {
		t.Fatalf("rotate A: %v %s", err, stderr)
	}
	rotatedA, err := provider.Get(first.AgentKeyRef.Key)
	if err != nil {
		t.Fatal(err)
	}
	unchangedB, err := provider.Get(second.AgentKeyRef.Key)
	if err != nil {
		t.Fatal(err)
	}
	if rotatedA == secretA || unchangedB != secretB || strings.Contains(out+stderr, rotatedA) {
		t.Fatal("rotation did not isolate the A slot")
	}
	teamKeyB, _ := second.Key.GetTeamAgentKey()
	out, stderr, err = runE2ECLI(h.bin, configPath, "agents", "keys", "rotate", teamKeyB.ID, "--team-id", b, "--store", "--destination", "file")
	if err != nil {
		t.Fatalf("rotate B: %v %s", err, stderr)
	}
	rotatedB, err := provider.Get(second.AgentKeyRef.Key)
	if err != nil {
		t.Fatal(err)
	}
	if currentA, err := provider.Get(first.AgentKeyRef.Key); err != nil || currentA != rotatedA || rotatedB == secretB || strings.Contains(out+stderr, rotatedB) {
		t.Fatal("rotation did not isolate the B slot")
	}
	// A newly issued key cannot overwrite an already-configured team grant.
	inviteOut, _ := h.run(t, "teams", "invite", "create", a, "--role", "member")
	var replacementInvite struct {
		Code string `json:"code"`
	}
	decodeJSON(t, inviteOut, &replacementInvite)
	out, stderr, err = enroll(replacementInvite.Code, uuid.NewString())
	if err == nil {
		t.Fatal("enrollment replaced a conflicting selected grant")
	}
	var conflict storedAgentKeyOutput
	decodeJSON(t, out, &conflict)
	if conflict.RecoveryPath == "" {
		t.Fatal("conflicting issued key needs recovery")
	}
	t.Cleanup(func() { _ = os.Remove(conflict.RecoveryPath) })
	if actual, err := provider.Get(first.AgentKeyRef.Key); err != nil || actual != rotatedA {
		t.Fatal("enrollment conflict damaged existing key")
	}
	// Inject a provider save failure after real issuance; old config stays usable.
	c, codeC := invitation()
	blocked := filepath.Join(root, "agent-key-teams", e2eAgentID, c)
	if err := os.MkdirAll(blocked, 0o700); err != nil {
		t.Fatal(err)
	}
	before, err = os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	out, stderr, err = enroll(codeC, uuid.NewString())
	if err == nil {
		t.Fatal("expected provider save failure")
	}
	var failed storedAgentKeyOutput
	decodeJSON(t, out, &failed)
	data, err := os.ReadFile(failed.RecoveryPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(failed.RecoveryPath) })
	var recovery agentKeyRecovery
	decodeJSON(t, string(data), &recovery)
	if info, err := os.Stat(failed.RecoveryPath); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("unprotected recovery file")
	}
	if recovery.Secret == "" || strings.Contains(out+stderr, recovery.Secret) {
		t.Fatal("missing protected secret or output leak")
	}
	after, err = os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("failed save changed existing config")
	}
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if err := provider.Set(recovery.AgentKeyRef.Key, recovery.Secret); err != nil {
		t.Fatal(err)
	}
	if err := updateTeamAgentKeyReference(configPath, e2eAgentID, c, recovery.AgentKeyRef); err != nil {
		t.Fatal(err)
	}
	// The SDK consumes all Go-written slots in key-only mode.
	saved, err = ReadConfigFrom(configPath)
	if err != nil {
		t.Fatal(err)
	}
	saved.OAuth2 = CredentialsOAuth2{}
	if _, err := WriteConfigTo(saved, configPath); err != nil {
		t.Fatal(err)
	}
	script := `import {connect,FileSecretProvider} from '../../libs/sdk/src/node.ts';import {SecretProviderRegistry} from '../../libs/sdk/src/secrets.ts';for(const teamId of process.argv.slice(2)){const agent=await connect({configDir:process.argv[1],teamId,secretProviders:new SecretProviderRegistry().register(new FileSecretProvider({root:process.env.MOLTNET_SECRET_ROOT}))});await agent.agents.whoami();}`
	cmd := exec.Command("node", "--import", "tsx", "--input-type=module", "-e", script, filepath.Dir(configPath), a, b, c)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("SDK consumption: %v %s", err, output)
	}
	if keyAuthenticatesCLI(t, h.bin, secretA) {
		t.Fatal("old A credential survived rotation")
	}
	if !keyAuthenticatesCLI(t, h.bin, rotatedA) || !keyAuthenticatesCLI(t, h.bin, rotatedB) {
		t.Fatal("independent rotations left an unusable credential")
	}
}
