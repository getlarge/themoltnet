package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCompareVersions(t *testing.T) {
	if got := compareVersions("1.90.0", "1.89.9"); got != 1 {
		t.Fatalf("newer = %d, want 1", got)
	}
	if got := compareVersions("1.89.9", "1.90.0"); got != -1 {
		t.Fatalf("older = %d, want -1", got)
	}
	if got := compareVersions("bad", "1.90.0"); got != 0 {
		t.Fatalf("invalid = %d, want 0", got)
	}
}

func TestCLIUpdateCommands(t *testing.T) {
	cases := map[string]string{"homebrew": "brew update && brew upgrade --cask moltnet", "apt": "sudo apt update && sudo apt install --only-upgrade moltnet", "scoop": "scoop update && scoop update moltnet", "npm": "npm install -g @themoltnet/cli@latest"}
	for method, want := range cases {
		if got := cliUpdateCommand(method, "/usr/local/bin/moltnet"); got != want {
			t.Errorf("%s: %q", method, got)
		}
	}
	if got := cliUpdateCommand("direct", "/usr/local/bin/moltnet"); got == "" {
		t.Fatal("direct command is empty")
	}
}

func TestDetectCLIInstallMethod(t *testing.T) {
	for path, want := range map[string]string{"/opt/homebrew/Caskroom/moltnet/1.0/moltnet": "homebrew", "/Users/a/scoop/apps/moltnet/current/moltnet.exe": "scoop", "/usr/lib/node_modules/@themoltnet/cli/bin/moltnet": "npm", "/usr/local/bin/moltnet": "direct"} {
		if got := detectCLIInstallMethod(path); got != want {
			t.Errorf("%s: got %q want %q", path, got, want)
		}
	}
}

func TestFetchCLILatestPicksNewestPublishedCLIRelease(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
		err  string
	}{
		{name: "stable", body: `[{"tag_name":"cli-v1.90.0","draft":false,"prerelease":false}]`, want: "1.90.0"},
		{
			// Other components dominate the listing; cli must still be found.
			name: "ignores other components",
			body: `[{"tag_name":"rest-api-v0.53.0"},{"tag_name":"sdk-v0.140.1"},{"tag_name":"cli-v1.91.0"}]`,
			want: "1.91.0",
		},
		{
			// The listing is ordered by creation date, so the newest cli release
			// is not necessarily first.
			name: "highest version wins over listing order",
			body: `[{"tag_name":"cli-v1.88.1"},{"tag_name":"cli-v1.91.0"},{"tag_name":"cli-v1.90.0"}]`,
			want: "1.91.0",
		},
		{
			// A token in CI sees this repository's stuck drafts.
			name: "skips drafts and prereleases",
			body: `[{"tag_name":"cli-v9.9.9","draft":true},{"tag_name":"cli-v9.9.8","prerelease":true},{"tag_name":"cli-v1.90.0"}]`,
			want: "1.90.0",
		},
		{name: "malformed", body: `[`, err: "invalid release listing"},
		{name: "prerelease version string", body: `[{"tag_name":"cli-v1.90.0-rc.1"}]`, err: "no valid CLI release"},
		{name: "no cli releases", body: `[{"tag_name":"rest-api-v0.53.0"}]`, err: "no valid CLI release"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(tt.body)) }))
			defer server.Close()
			oldURL := cliUpdateReleasesURL
			cliUpdateReleasesURL = server.URL
			defer func() { cliUpdateReleasesURL = oldURL }()
			got, err := fetchCLILatest(context.Background())
			if tt.err != "" {
				if err == nil || !strings.Contains(err.Error(), tt.err) {
					t.Fatalf("error = %v, want %q", err, tt.err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("fetchCLILatest() = %q, %v; want %q", got, err, tt.want)
			}
		})
	}
}

// A Homebrew cask is reached through a shim symlink; detection matches on the
// Caskroom target behind it.
func TestResolveCLIExecutableFollowsSymlinks(t *testing.T) {
	dir := t.TempDir()
	caskroom := filepath.Join(dir, "Caskroom", "moltnet", "1.91.0")
	if err := os.MkdirAll(caskroom, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(caskroom, "moltnet")
	if err := os.WriteFile(target, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(dir, "moltnet")
	if err := os.Symlink(target, shim); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	if got := detectCLIInstallMethod(shim); got != "direct" {
		t.Fatalf("unresolved shim = %q, want \"direct\" (guards the regression)", got)
	}
	resolved := resolveCLIExecutable(shim)
	if got := detectCLIInstallMethod(resolved); got != "homebrew" {
		t.Fatalf("resolved = %q via %q, want \"homebrew\"", got, resolved)
	}
	if got := resolveCLIExecutable(filepath.Join(dir, "does-not-exist")); got == "" {
		t.Fatal("missing path should fall back to the input, not empty")
	}
	if got := resolveCLIExecutable(""); got != "" {
		t.Fatalf("empty input = %q, want empty", got)
	}
}

func TestCheckCLIUpdateUsesFreshCacheAndRefreshesStaleCache(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	if err := writeUpdateCache("cli", updateCache{CheckedAt: time.Now().UTC(), Latest: "1.90.0"}); err != nil {
		t.Fatal(err)
	}
	oldURL := cliUpdateReleasesURL
	cliUpdateReleasesURL = "http://127.0.0.1:1/unreachable"
	defer func() { cliUpdateReleasesURL = oldURL }()
	cached, err := checkCLIUpdate(context.Background(), "1.89.0", false)
	if err != nil || !cached.UpdateAvailable || cached.Latest != "1.90.0" {
		t.Fatalf("cached check = %#v, %v", cached, err)
	}
	if err := writeUpdateCache("cli", updateCache{CheckedAt: time.Now().Add(-updateCacheTTL - time.Second), Latest: "1.89.0"}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`[{"tag_name":"cli-v1.91.0"}]`)) }))
	defer server.Close()
	cliUpdateReleasesURL = server.URL
	refreshed, err := checkCLIUpdate(context.Background(), "1.89.0", false)
	if err != nil || refreshed.Latest != "1.91.0" || !refreshed.UpdateAvailable {
		t.Fatalf("refreshed check = %#v, %v", refreshed, err)
	}
}

func TestUpdateCheckCommandRendersTextAndJSON(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`[{"tag_name":"cli-v1.90.0"}]`)) }))
	defer server.Close()
	oldURL := cliUpdateReleasesURL
	cliUpdateReleasesURL = server.URL
	defer func() { cliUpdateReleasesURL = oldURL }()

	textCmd := newUpdateCmd("1.89.0")
	var text bytes.Buffer
	textCmd.SetOut(&text)
	textCmd.SetArgs([]string{"check"})
	if err := textCmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text.String(), "MoltNet CLI 1.90.0 is available") || !strings.Contains(text.String(), "Run:") {
		t.Fatalf("text output = %q", text.String())
	}

	jsonCmd := newUpdateCmd("1.89.0")
	var output bytes.Buffer
	jsonCmd.SetOut(&output)
	jsonCmd.SetArgs([]string{"check", "--json"})
	if err := jsonCmd.Execute(); err != nil {
		t.Fatal(err)
	}
	var result updateResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Current != "1.89.0" || result.Latest != "1.90.0" || !result.UpdateAvailable || result.Command == "" {
		t.Fatalf("json result = %#v", result)
	}
}

func TestUpdateCachePermissions(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	if err := writeUpdateCache("cli", updateCache{CheckedAt: time.Now().UTC(), Latest: "1.90.0"}); err != nil {
		t.Fatal(err)
	}
	path, err := updateCachePath("cli")
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("cache mode = %o, want 600", info.Mode().Perm())
	}
	if filepath.Base(path) != "cli.json" {
		t.Fatalf("cache path = %q", path)
	}
}
