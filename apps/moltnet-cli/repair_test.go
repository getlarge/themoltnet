package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepair_StripsPollutedGitConfig(t *testing.T) {
	dir := t.TempDir()
	gitDir := filepath.Join(dir, ".git")
	os.MkdirAll(gitDir, 0o755)
	gitConfig := filepath.Join(gitDir, "config")
	os.WriteFile(gitConfig, []byte(`[core]
	repositoryformatversion = 0
[url "https://x-access-token:ghs_LEAKED@github.com/"]
	insteadof = git@github.com:
`), 0o644)

	changed, err := repairGitConfigTokens(gitConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected repair to report a change")
	}
	b, _ := os.ReadFile(gitConfig)
	if hasTokenBearingRule(string(b)) {
		t.Fatalf("token not stripped:\n%s", b)
	}
	// Missing file must be a silent no-op.
	changed2, err := repairGitConfigTokens(filepath.Join(dir, "nope", "config"))
	if err != nil {
		t.Fatalf("missing file should not error: %v", err)
	}
	if changed2 {
		t.Fatal("missing file should report no change")
	}
}

func TestRepair_AddsHelperResetToShadowProneGitconfig(t *testing.T) {
	dir := t.TempDir()
	gitconfig := filepath.Join(dir, "gitconfig")
	os.WriteFile(gitconfig, []byte(`[user]
	name = LeGreffier
[credential "https://github.com"]
	helper = "!moltnet github credential-helper --credentials /x/moltnet.json"
[url "https://github.com/"]
	insteadOf = git@github.com:
`), 0o644)

	changed, err := repairHelperShadowing(gitconfig)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected a change for shadow-prone gitconfig")
	}
	b, _ := os.ReadFile(gitconfig)
	if needsHelperReset(string(b)) {
		t.Fatalf("reset still missing after repair:\n%s", b)
	}
	// Second pass is a no-op.
	changed2, _ := repairHelperShadowing(gitconfig)
	if changed2 {
		t.Fatal("second pass should not change an already-fixed gitconfig")
	}
	// Missing file is a silent no-op.
	changed3, err := repairHelperShadowing(filepath.Join(dir, "nope"))
	if err != nil || changed3 {
		t.Fatalf("missing file: want (false,nil) got (%v,%v)", changed3, err)
	}
}

func TestLoadAndValidate_ValidConfig(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID:   "test-agent-12345678",
		SubjectType: SubjectTypeAgent,
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=",
			PrivateKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			Fingerprint: "TEST-TEST-TEST-TEST",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://mcp.themolt.net/mcp",
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d: %v", len(issues), issues)
	}
}

func TestLoadAndValidate_MissingFields(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{} // all empty
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	fields := map[string]bool{}
	for _, iss := range issues {
		fields[iss.Field] = true
	}

	for _, required := range []string{"subject_id", "keys.public_key", "keys.private_key", "endpoints.api"} {
		if !fields[required] {
			t.Errorf("expected warning for %s, not found in issues", required)
		}
	}
}

func TestLoadAndValidate_FixesMissingMCP(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			// MCP intentionally missing
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, updated, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var fixedMCP bool
	for _, iss := range issues {
		if iss.Field == "endpoints.mcp" && iss.Action == "fixed" {
			fixedMCP = true
		}
	}
	if !fixedMCP {
		t.Error("expected 'fixed' issue for endpoints.mcp")
	}
	if updated.Endpoints.MCP != "https://mcp.themolt.net/mcp" {
		t.Errorf("MCP endpoint = %q, want %q", updated.Endpoints.MCP, "https://mcp.themolt.net/mcp")
	}
}

func TestLoadAndValidate_StaleSSHPaths(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://mcp.themolt.net/mcp",
		},
		SSH: &SSHSection{
			PrivateKeyPath: "/nonexistent/path/id_ed25519",
			PublicKeyPath:  "/nonexistent/path/id_ed25519.pub",
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	staleCount := 0
	for _, iss := range issues {
		if iss.Field == "ssh.private_key_path" || iss.Field == "ssh.public_key_path" {
			staleCount++
		}
	}
	if staleCount != 2 {
		t.Errorf("expected 2 stale SSH path warnings, got %d", staleCount)
	}
}

func TestLoadAndValidate_IgnoresCredentialsJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	configDir := filepath.Join(tmpDir, ".config", "moltnet")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	creds := CredentialsFile{
		SubjectID: "legacy-agent",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://mcp.themolt.net/mcp",
		},
	}
	writeTestConfig(t, configDir, "credentials.json", creds)

	_, _, _, err := loadAndValidate("")
	if err == nil {
		t.Fatal("expected credentials.json to be ignored")
	}
	if !strings.Contains(err.Error(), "moltnet.json") {
		t.Fatalf("error = %q, want moltnet.json path", err)
	}
}

func TestRunConfigRepair_DryRun(t *testing.T) {
	// Repair also inspects the current repository's config; never a real one.
	t.Chdir(t.TempDir())
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			// MCP missing — fixable
		},
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	err := runConfigRepair([]string{"--credentials", credPath, "--dry-run"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify file was NOT modified
	updated, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if updated.Endpoints.MCP != "" {
		t.Error("dry-run should not have modified the config")
	}
}

func TestRunConfigRepair_AppliesFixes(t *testing.T) {
	// Repair also inspects the current repository's config; never a real one.
	t.Chdir(t.TempDir())
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
		},
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	err := runConfigRepair([]string{"--credentials", credPath})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	updated, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if updated.Endpoints.MCP != "https://mcp.themolt.net/mcp" {
		t.Errorf("MCP endpoint = %q, want %q", updated.Endpoints.MCP, "https://mcp.themolt.net/mcp")
	}
}

func TestLoadAndValidate_EnvAuthorshipInvalid(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://mcp.themolt.net/mcp",
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	// Write env file with invalid authorship mode
	envContent := "MOLTNET_COMMIT_AUTHORSHIP='invalid'\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var found bool
	for _, iss := range issues {
		if iss.Field == "env.MOLTNET_COMMIT_AUTHORSHIP" {
			found = true
		}
	}
	if !found {
		t.Error("expected warning for invalid MOLTNET_COMMIT_AUTHORSHIP")
	}
}

func TestLoadAndValidate_EnvMissingHumanIdentity(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://mcp.themolt.net/mcp",
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	// coauthor mode but no human identity
	envContent := "MOLTNET_COMMIT_AUTHORSHIP='coauthor'\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var found bool
	for _, iss := range issues {
		if iss.Field == "env.MOLTNET_HUMAN_GIT_IDENTITY" && strings.Contains(iss.Problem, "missing") {
			found = true
		}
	}
	if !found {
		t.Error("expected warning for missing MOLTNET_HUMAN_GIT_IDENTITY in coauthor mode")
	}
}

func TestLoadAndValidate_EnvValidAuthorship(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		SubjectID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://mcp.themolt.net/mcp",
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	envContent := strings.Join([]string{
		"MOLTNET_COMMIT_AUTHORSHIP='coauthor'",
		"MOLTNET_HUMAN_GIT_IDENTITY='Jane Doe <jane@example.com>'",
	}, "\n")
	if err := os.WriteFile(filepath.Join(tmpDir, "env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, iss := range issues {
		if strings.HasPrefix(iss.Field, "env.") {
			t.Errorf("unexpected env issue: [%s] %s: %s", iss.Action, iss.Field, iss.Problem)
		}
	}
}

func writeTestConfig(t *testing.T, dir, filename string, creds CredentialsFile) {
	t.Helper()
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, filename), data, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// --- gpg.ssh.allowedSignersFile ---

// writeSignerFixture builds an identity directory with an exported SSH public
// key plus a gitconfig whose allowedSignersFile points wherever the caller says.
func writeSignerFixture(t *testing.T, configDir, signersPath string) (string, *CredentialsFile) {
	t.Helper()
	pubKeyPath := filepath.Join(configDir, "ssh", "id_ed25519.pub")
	if err := os.MkdirAll(filepath.Dir(pubKeyPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pubKeyPath, []byte("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitconfig := filepath.Join(configDir, "gitconfig")
	contents := "[user]\n\tsigningkey = " + pubKeyPath +
		"\n[gpg]\n\tformat = ssh\n[commit]\n\tgpgsign = true\n"
	if signersPath != "" {
		contents += "[gpg \"ssh\"]\n\tallowedSignersFile = " + signersPath + "\n"
	}
	if err := os.WriteFile(gitconfig, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
	creds := &CredentialsFile{
		SSH: &SSHSection{PublicKeyPath: pubKeyPath},
		Git: &GitSection{Name: "LeGreffier", Email: "bot@example.test"},
	}
	return gitconfig, creds
}

func TestConfigsMissingAllowedSigners_DetectsUnsetAndStale(t *testing.T) {
	// Arrange
	dir := t.TempDir()
	missing := filepath.Join(dir, "gone", "ssh", "allowed_signers")
	gitconfig, _ := writeSignerFixture(t, dir, missing)

	present := filepath.Join(dir, "present")
	if err := os.WriteFile(present, []byte("bot@example.test ssh-ed25519 AAAA\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	okDir := t.TempDir()
	okConfig, _ := writeSignerFixture(t, okDir, present)

	// The legacy shape: signs with SSH, but the key was never written.
	legacyDir := t.TempDir()
	legacyConfig, _ := writeSignerFixture(t, legacyDir, "")

	// Not an SSH-signing config — repair must leave it alone.
	unrelated := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(unrelated, []byte("[user]\n\tname = x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Act
	broken := configsMissingAllowedSigners([]string{
		gitconfig,
		okConfig,
		legacyConfig,
		unrelated,
		filepath.Join(dir, "does-not-exist"),
	})

	// Assert
	got := map[string]bool{}
	for _, p := range broken {
		got[p] = true
	}
	if len(broken) != 2 || !got[gitconfig] || !got[legacyConfig] {
		t.Fatalf("expected the stale and legacy configs, got %v", broken)
	}
}

// The reported symptom: a gitconfig that signs but never had the key written,
// with a perfectly good allowed_signers sitting unreferenced beside it.
func TestRepairAllowedSigners_SetsKeyWhenUnset(t *testing.T) {
	// Arrange
	dir := t.TempDir()
	gitconfig, creds := writeSignerFixture(t, dir, "")
	if got := gitConfigValue(gitconfig, "gpg.ssh.allowedSignersFile"); got != "" {
		t.Fatalf("fixture should start with the key unset, got %q", got)
	}

	// Act
	changed, err := repairAllowedSigners(gitconfig, dir, creds)

	// Assert
	if err != nil || !changed {
		t.Fatalf("repairAllowedSigners() changed=%v err=%v", changed, err)
	}
	canonical := allowedSignersPathFor(dir)
	if got := gitConfigValue(gitconfig, "gpg.ssh.allowedSignersFile"); got != canonical {
		t.Fatalf("expected key set to %s, got %s", canonical, got)
	}
	if _, err := os.Stat(canonical); err != nil {
		t.Fatalf("allowed_signers not written: %v", err)
	}
}

func TestRepairAllowedSigners_RegeneratesAndRepoints(t *testing.T) {
	// Arrange — a config pointing into a checkout that no longer exists, the
	// shape left behind when an identity moves to the central store.
	dir := t.TempDir()
	stale := filepath.Join(dir, "old-checkout", ".moltnet", "legreffier", "ssh", "allowed_signers")
	gitconfig, creds := writeSignerFixture(t, dir, stale)

	// Act
	changed, err := repairAllowedSigners(gitconfig, dir, creds)

	// Assert
	if err != nil {
		t.Fatalf("repairAllowedSigners() error: %v", err)
	}
	if !changed {
		t.Fatal("expected repair to report a change")
	}
	canonical := allowedSignersPathFor(dir)
	if got := gitConfigValue(gitconfig, "gpg.ssh.allowedSignersFile"); got != canonical {
		t.Fatalf("expected config repointed to %s, got %s", canonical, got)
	}
	body, err := os.ReadFile(canonical)
	if err != nil {
		t.Fatalf("canonical allowed_signers not written: %v", err)
	}
	// git verifies against this exact document, so both halves must be present.
	if !strings.Contains(string(body), "bot@example.test") ||
		!strings.Contains(string(body), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY") {
		t.Fatalf("unexpected allowed_signers content: %q", body)
	}
	// The stale directory must not be resurrected.
	if _, err := os.Stat(filepath.Dir(stale)); err == nil {
		t.Fatal("repair recreated the abandoned checkout path")
	}

	// Idempotent: a second run is a no-op that still reports success.
	changedAgain, err := repairAllowedSigners(gitconfig, dir, creds)
	if err != nil || !changedAgain {
		t.Fatalf("second run: changed=%v err=%v", changedAgain, err)
	}
}

func TestRepairAllowedSigners_RequiresExportedKeyAndEmail(t *testing.T) {
	// Arrange
	dir := t.TempDir()
	gitconfig, creds := writeSignerFixture(t, dir, filepath.Join(dir, "missing"))

	// Act / Assert — no SSH export.
	noSSH := &CredentialsFile{Git: creds.Git}
	if _, err := repairAllowedSigners(gitconfig, dir, noSSH); err == nil ||
		!strings.Contains(err.Error(), "ssh-key") {
		t.Fatalf("expected an ssh-key hint, got: %v", err)
	}

	// Act / Assert — no git email.
	noEmail := &CredentialsFile{SSH: creds.SSH}
	if _, err := repairAllowedSigners(gitconfig, dir, noEmail); err == nil ||
		!strings.Contains(err.Error(), "git setup") {
		t.Fatalf("expected a git-setup hint, got: %v", err)
	}
}

const (
	moltnetHelperGitconfig = `[credential "https://github.com"]
	helper =
	helper = "!moltnet github credential-helper --credentials /x/moltnet.json"
`
)

func writeRepairGitconfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// Identities set up before useHttpPath was installed lack it, and Git then
// strips the request path before the helper sees it. Only configs that route
// github.com through the MoltNet helper are MoltNet's to fix.
func TestPathlessCredentialHelperConfigs(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		content string
		flagged bool
	}{
		{"moltnet helper without useHttpPath", moltnetHelperGitconfig, true},
		{"moltnet helper with useHttpPath false", moltnetHelperGitconfig + "\tuseHttpPath = false\n", true},
		{"moltnet helper with useHttpPath true", moltnetHelperGitconfig + "\tuseHttpPath = true\n", false},
		{"moltnet helper with useHttpPath yes", moltnetHelperGitconfig + "\tuseHttpPath = yes\n", false},
		{"a different helper", "[credential \"https://github.com\"]\n\thelper = osxkeychain\n", false},
		{"no credential section", "[user]\n\tname = someone\n", false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := writeRepairGitconfig(t, testCase.content)
			got := pathlessCredentialHelperConfigs([]string{path})
			if flagged := len(got) == 1; flagged != testCase.flagged {
				t.Fatalf("flagged = %v, want %v", flagged, testCase.flagged)
			}
		})
	}
	if got := pathlessCredentialHelperConfigs([]string{filepath.Join(t.TempDir(), "missing")}); len(got) != 0 {
		t.Fatalf("a missing config must not be flagged, got %v", got)
	}
}

func TestEnsureGitHubCredentialUsePath_IsIdempotent(t *testing.T) {
	path := writeRepairGitconfig(t, moltnetHelperGitconfig+"\tuseHttpPath = false\n")
	changed, err := ensureGitHubCredentialUsePath(path)
	if err != nil || !changed {
		t.Fatalf("first pass: changed=%v err=%v, want a change", changed, err)
	}
	if got := gitConfigValue(path, githubCredentialUsePathKey); got != "true" {
		t.Fatalf("useHttpPath = %q, want true", got)
	}
	changed, err = ensureGitHubCredentialUsePath(path)
	if err != nil || changed {
		t.Fatalf("second pass: changed=%v err=%v, want no change", changed, err)
	}
	if got := pathlessCredentialHelperConfigs([]string{path}); len(got) != 0 {
		t.Fatalf("still flagged after the fix: %v", got)
	}
}

// End to end through `moltnet config repair`: the agent gitconfig named in
// moltnet.json gains useHttpPath, and --dry-run reports without writing.
func TestRunConfigRepair_EnablesUseHTTPPathForTheAgentGitconfig(t *testing.T) {
	// Run outside any checkout: repair also inspects the current repository's
	// .git/config, and a test must never touch a real one.
	t.Chdir(t.TempDir())
	tmpDir := t.TempDir()
	gitconfig := writeRepairGitconfig(t, moltnetHelperGitconfig)
	creds := CredentialsFile{
		SubjectID: "test",
		Keys:      CredentialsKeys{PublicKey: "ed25519:abc=", PrivateKey: "abc="},
		Endpoints: CredentialsEndpoints{API: "https://api.themolt.net", MCP: "https://mcp.themolt.net/mcp"},
		Git:       &GitSection{ConfigPath: gitconfig},
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	if err := runConfigRepair([]string{"--credentials", credPath, "--dry-run"}); err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if got := gitConfigValue(gitconfig, githubCredentialUsePathKey); got != "" {
		t.Fatalf("dry run wrote useHttpPath = %q", got)
	}

	if err := runConfigRepair([]string{"--credentials", credPath}); err != nil {
		t.Fatalf("repair: %v", err)
	}
	if got := gitConfigValue(gitconfig, githubCredentialUsePathKey); got != "true" {
		t.Fatalf("useHttpPath = %q after repair, want true", got)
	}
}

// Regression: a moltnet.json written before the central identity store can
// name an older gitconfig. Repair must still fix the gitconfig beside
// moltnet.json, which is the one the identity env points GIT_CONFIG_GLOBAL at.
func TestRunConfigRepair_FixesTheIdentityGitconfigWhenConfigPathIsStale(t *testing.T) {
	t.Chdir(t.TempDir())
	identityDir := t.TempDir()
	stale := writeRepairGitconfig(t, "[user]\n\tname = previous-location\n")
	live := filepath.Join(identityDir, "gitconfig")
	if err := os.WriteFile(live, []byte(moltnetHelperGitconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	creds := CredentialsFile{
		SubjectID: "test",
		Keys:      CredentialsKeys{PublicKey: "ed25519:abc=", PrivateKey: "abc="},
		Endpoints: CredentialsEndpoints{API: "https://api.themolt.net", MCP: "https://mcp.themolt.net/mcp"},
		Git:       &GitSection{ConfigPath: stale},
	}
	credPath := filepath.Join(identityDir, "moltnet.json")
	writeTestConfig(t, identityDir, "moltnet.json", creds)

	if err := runConfigRepair([]string{"--credentials", credPath}); err != nil {
		t.Fatalf("repair: %v", err)
	}
	if got := gitConfigValue(live, githubCredentialUsePathKey); got != "true" {
		t.Fatalf("the identity gitconfig was not fixed: useHttpPath = %q", got)
	}
}

func TestGitConfigCandidates_ListsTheIdentityGitconfigOnce(t *testing.T) {
	t.Chdir(t.TempDir())
	identityDir := t.TempDir()
	live := filepath.Join(identityDir, "gitconfig")
	if err := os.WriteFile(live, []byte(moltnetHelperGitconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	credPath := filepath.Join(identityDir, "moltnet.json")
	count := func(paths []string, target string) int {
		n := 0
		for _, p := range paths {
			if filepath.Clean(p) == filepath.Clean(target) {
				n++
			}
		}
		return n
	}

	upToDate := gitConfigCandidates(&CredentialsFile{Git: &GitSection{ConfigPath: live}}, credPath)
	if count(upToDate, live) != 1 {
		t.Fatalf("an up-to-date config_path must list the identity gitconfig once, got %v", upToDate)
	}

	stale := writeRepairGitconfig(t, "[user]\n\tname = previous-location\n")
	both := gitConfigCandidates(&CredentialsFile{Git: &GitSection{ConfigPath: stale}}, credPath)
	if count(both, live) != 1 || count(both, stale) != 1 {
		t.Fatalf("a stale config_path must list both files once, got %v", both)
	}
}

// staleConfigPathIdentity lays out an identity whose moltnet.json names an
// older gitconfig while the gitconfig beside it is the live one. envValue is
// the identity env's GIT_CONFIG_GLOBAL ("" writes no env file).
func staleConfigPathIdentity(t *testing.T, envValue string) (identityDir, credPath, stale, live string) {
	t.Helper()
	identityDir = t.TempDir()
	stale = writeRepairGitconfig(t, "[user]\n\tname = previous-location\n")
	live = filepath.Join(identityDir, "gitconfig")
	if err := os.WriteFile(live, []byte(moltnetHelperGitconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	if envValue != "" {
		if err := os.WriteFile(filepath.Join(identityDir, "env"), []byte("GIT_CONFIG_GLOBAL='"+envValue+"'\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	creds := CredentialsFile{
		SubjectID: "test",
		Keys:      CredentialsKeys{PublicKey: "ed25519:abc=", PrivateKey: "abc="},
		Endpoints: CredentialsEndpoints{API: "https://api.themolt.net", MCP: "https://mcp.themolt.net/mcp"},
		Git:       &GitSection{ConfigPath: stale},
	}
	credPath = filepath.Join(identityDir, "moltnet.json")
	writeTestConfig(t, identityDir, "moltnet.json", creds)
	return identityDir, credPath, stale, live
}

func TestLoadAndValidate_RepointsAStaleGitConfigPath(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		envValue func(live string) string
	}{
		{"absolute GIT_CONFIG_GLOBAL", func(live string) string { return live }},
		{"relative GIT_CONFIG_GLOBAL", func(string) string { return "gitconfig" }},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			identityDir := t.TempDir()
			_, credPath, _, live := staleConfigPathIdentity(t, testCase.envValue(filepath.Join(identityDir, "gitconfig")))
			// Recompute with the real live path for the absolute case.
			if testCase.name == "absolute GIT_CONFIG_GLOBAL" {
				if err := os.WriteFile(filepath.Join(filepath.Dir(credPath), "env"), []byte("GIT_CONFIG_GLOBAL='"+live+"'\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			_, creds, issues, err := loadAndValidate(credPath)
			if err != nil {
				t.Fatal(err)
			}
			if creds.Git.ConfigPath != live {
				t.Fatalf("config_path = %q, want %q", creds.Git.ConfigPath, live)
			}
			found := false
			for _, issue := range issues {
				if issue.Field == "git.config_path" && issue.Action == "fixed" {
					found = true
				}
			}
			if !found {
				t.Fatalf("no fixed git.config_path issue reported: %+v", issues)
			}
		})
	}
}

// Repair must never make config_path disagree with the gitconfig sessions use.
func TestLoadAndValidate_LeavesConfigPathWhenTheEnvDisagrees(t *testing.T) {
	_, credPath, stale, _ := staleConfigPathIdentity(t, "")
	// The env points sessions at the older file, so it is not stale.
	if err := os.WriteFile(filepath.Join(filepath.Dir(credPath), "env"), []byte("GIT_CONFIG_GLOBAL='"+stale+"'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, creds, _, err := loadAndValidate(credPath)
	if err != nil {
		t.Fatal(err)
	}
	if creds.Git.ConfigPath != stale {
		t.Fatalf("config_path was repointed despite the env: %q", creds.Git.ConfigPath)
	}

	// No env file at all: nothing says which gitconfig sessions use.
	_, credPath, stale, _ = staleConfigPathIdentity(t, "")
	_, creds, _, err = loadAndValidate(credPath)
	if err != nil {
		t.Fatal(err)
	}
	if creds.Git.ConfigPath != stale {
		t.Fatalf("config_path was repointed without an env: %q", creds.Git.ConfigPath)
	}
}

func TestRunConfigRepair_RewritesAStaleGitConfigPath(t *testing.T) {
	t.Chdir(t.TempDir())
	identityDir := t.TempDir()
	_ = identityDir
	_, credPath, stale, live := staleConfigPathIdentity(t, "gitconfig")

	if err := runConfigRepair([]string{"--credentials", credPath, "--dry-run"}); err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if got, _ := ReadConfigFrom(credPath); got.Git.ConfigPath != stale {
		t.Fatalf("dry run rewrote config_path to %q", got.Git.ConfigPath)
	}

	if err := runConfigRepair([]string{"--credentials", credPath}); err != nil {
		t.Fatalf("repair: %v", err)
	}
	got, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatal(err)
	}
	if got.Git.ConfigPath != live {
		t.Fatalf("config_path = %q after repair, want %q", got.Git.ConfigPath, live)
	}
}

// Without --credentials, repair must act on the selected identity, as every
// other command does. It used to read the store root's moltnet.json, which no
// longer exists under the central identity store.
func TestRunConfigRepair_WithoutCredentialsRepairsTheSelectedIdentity(t *testing.T) {
	t.Chdir(t.TempDir())
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("MOLTNET_ACTIVE_IDENTITY", "")
	identityDir := filepath.Join(home, ".config", "moltnet", "identities", "test-agent")
	if err := os.MkdirAll(identityDir, 0o700); err != nil {
		t.Fatal(err)
	}
	writeTestConfig(t, identityDir, "moltnet.json", CredentialsFile{
		SubjectID: "test",
		Keys:      CredentialsKeys{PublicKey: "ed25519:abc=", PrivateKey: "abc="},
		Endpoints: CredentialsEndpoints{API: "https://api.themolt.net"}, // MCP missing: fixable
	})
	if err := writeIdentitySelector("test-agent"); err != nil {
		t.Fatal(err)
	}

	if err := runConfigRepair([]string{}); err != nil {
		t.Fatalf("repair without --credentials: %v", err)
	}
	got, err := ReadConfigFrom(filepath.Join(identityDir, "moltnet.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Endpoints.MCP != "https://mcp.themolt.net/mcp" {
		t.Fatalf("the selected identity was not repaired: MCP = %q", got.Endpoints.MCP)
	}
}

func TestHelperCredentialsArgument(t *testing.T) {
	for helper, want := range map[string]string{
		"!moltnet github credential-helper --credentials '/a b/moltnet.json'":   "/a b/moltnet.json",
		"!moltnet github credential-helper --credentials /a/moltnet.json":       "/a/moltnet.json",
		`!moltnet github credential-helper --credentials "/a/moltnet.json"`:     "/a/moltnet.json",
		"!moltnet github credential-helper --credentials=/a/moltnet.json":       "/a/moltnet.json",
		"!npx @themoltnet/cli github credential-helper --credentials /a/m.json": "/a/m.json",
		"!moltnet github credential-helper":                                     "",
		"":                                                                      "",
		"osxkeychain":                                                           "",
	} {
		if got := helperCredentialsArgument(helper); got != want {
			t.Errorf("helperCredentialsArgument(%q) = %q, want %q", helper, got, want)
		}
	}
}

// repairRepository creates a Git repository whose config binds the MoltNet
// helper to legacyCreds, isolated from the operator's own Git configuration,
// and makes it the working directory.
func repairRepository(t *testing.T, legacyCreds string) string {
	t.Helper()
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	repo := t.TempDir()
	runTestGit(t, repo, "init", "-q")
	repoConfig := filepath.Join(repo, ".git", "config")
	for _, value := range []string{"", "!moltnet github credential-helper --credentials " + legacyCreds} {
		if err := runGitConfig(repoConfig, "--add", "credential.https://github.com.helper", value); err != nil {
			t.Fatal(err)
		}
	}
	// Leave the helper binding as the only thing repair can find.
	if _, err := ensureGitHubCredentialUsePath(repoConfig); err != nil {
		t.Fatal(err)
	}
	t.Chdir(repo)
	return repoConfig
}

func runTestGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", dir}, args...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}

// identityCopy writes an otherwise valid moltnet.json holding publicKey into a
// fresh directory.
func identityCopy(t *testing.T, publicKey string) string {
	t.Helper()
	dir := t.TempDir()
	writeTestConfig(t, dir, "moltnet.json", CredentialsFile{
		SubjectID:   "11111111-1111-4111-8111-111111111111",
		SubjectType: SubjectTypeAgent,
		Keys:        CredentialsKeys{PublicKey: publicKey, PrivateKey: "abc="},
		Endpoints:   CredentialsEndpoints{API: "https://api.themolt.net", MCP: "https://mcp.themolt.net/mcp"},
	})
	return filepath.Join(dir, "moltnet.json")
}

// A checkout configured before the central identity store binds its helper to
// the bundle it used then. That repository-level helper overrides the
// identity's own, so repair rebinds it — keeping the reset — when the bundle
// is another copy of the same identity, even when nothing else needs repair.
func TestRunConfigRepair_RebindsTheRepositoryHelperToTheIdentity(t *testing.T) {
	legacy := identityCopy(t, "ed25519:abc=")
	repoConfig := repairRepository(t, legacy)
	credPath := identityCopy(t, "ed25519:abc=")
	legacyHelpers, _ := gitConfigGetAll(repoConfig, "credential.https://github.com.helper")

	if err := runConfigRepair([]string{"--credentials", credPath, "--dry-run"}); err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if got, _ := gitConfigGetAll(repoConfig, "credential.https://github.com.helper"); !equalStrings(got, legacyHelpers) {
		t.Fatalf("dry run changed the repository helper: %q", got)
	}

	if err := runConfigRepair([]string{"--credentials", credPath}); err != nil {
		t.Fatalf("repair: %v", err)
	}
	helper, err := githubCredentialHelperCommand(credPath)
	if err != nil {
		t.Fatal(err)
	}
	got, err := gitConfigGetAll(repoConfig, "credential.https://github.com.helper")
	if err != nil || !equalStrings(got, []string{"", "!" + helper}) {
		t.Fatalf("repository helpers = %q (%v), want the reset then %q", got, err, "!"+helper)
	}
}

// Another agent's bundle, or one that cannot be read, may be deliberate: repair
// reports it and leaves the helper alone.
func TestRunConfigRepair_LeavesAnotherAgentsRepositoryHelper(t *testing.T) {
	for name, legacy := range map[string]func(t *testing.T) string{
		"another agent":  func(t *testing.T) string { return identityCopy(t, "ed25519:other=") },
		"missing bundle": func(t *testing.T) string { return filepath.Join(t.TempDir(), "moltnet.json") },
	} {
		t.Run(name, func(t *testing.T) {
			legacyPath := legacy(t)
			repoConfig := repairRepository(t, legacyPath)
			credPath := identityCopy(t, "ed25519:abc=")

			named, sameAgent := repositoryHelperCredentials(repositoryGitConfig(), credPath, &CredentialsFile{Keys: CredentialsKeys{PublicKey: "ed25519:abc="}})
			if named != legacyPath || sameAgent {
				t.Fatalf("repositoryHelperCredentials = (%q, %v), want (%q, false)", named, sameAgent, legacyPath)
			}
			if err := runConfigRepair([]string{"--credentials", credPath}); err != nil {
				t.Fatalf("repair: %v", err)
			}
			got, _ := gitConfigGetAll(repoConfig, "credential.https://github.com.helper")
			if !equalStrings(got, []string{"", "!moltnet github credential-helper --credentials " + legacyPath}) {
				t.Fatalf("repository helper was changed: %q", got)
			}
		})
	}
}

// A helper already bound to the identity, or with no --credentials at all, is
// not reported.
func TestRepositoryHelperCredentials_IgnoresHelpersBoundToTheIdentity(t *testing.T) {
	credPath := identityCopy(t, "ed25519:abc=")
	creds := &CredentialsFile{Keys: CredentialsKeys{PublicKey: "ed25519:abc="}}
	for name, value := range map[string]string{
		"bound to the identity": "!moltnet github credential-helper --credentials " + credPath,
		"selected identity":     "!moltnet github credential-helper",
		"not a MoltNet helper":  "osxkeychain",
	} {
		t.Run(name, func(t *testing.T) {
			repoConfig := writeRepairGitconfig(t, "")
			if err := runGitConfig(repoConfig, "--add", "credential.https://github.com.helper", value); err != nil {
				t.Fatal(err)
			}
			if named, _ := repositoryHelperCredentials(repoConfig, credPath, creds); named != "" {
				t.Fatalf("reported %q", named)
			}
		})
	}
}

// Worktrees share their main checkout's config; repair must inspect it there.
func TestRepositoryGitConfig_ResolvesTheSharedConfigFromAWorktree(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	repo := t.TempDir()
	runTestGit(t, repo, "init", "-q")
	runTestGit(t, repo, "-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false",
		"commit", "-q", "--allow-empty", "-m", "init")
	worktree := filepath.Join(t.TempDir(), "worktree")
	runTestGit(t, repo, "worktree", "add", "-q", worktree)
	t.Chdir(worktree)

	if got := repositoryGitConfig(); !sameFile(got, filepath.Join(repo, ".git", "config")) {
		t.Fatalf("repositoryGitConfig() = %q, want the main checkout's config", got)
	}
}
