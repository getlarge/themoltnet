package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// preservedTestEnv lists MOLTNET_* variables that select which tests run, as
// opposed to variables that feed them credentials.
//
// Scrubbing the whole prefix took this one with it, which silently disabled the
// Go half of the native-keyring job: TestOSKeyringSecretProviderRoundTrip
// skipped on all three platforms while the job still reported success. A gate
// that is cleared before it is read fails open and is invisible, so anything
// added here must be a switch, never a secret.
var preservedTestEnv = map[string]bool{
	"MOLTNET_RUN_NATIVE_KEYRING_TESTS": true,
}

// isolateTestEnvironment moves the whole package off the developer's real
// MoltNet state. Both TestMain variants (unit and e2e) call it: the e2e build
// replaces the unit TestMain, and when only the unit one isolated, running
// `go test -tags e2e` from an activated shell let unit fixtures overwrite the
// real ~/.config/moltnet.
//
// It relocates HOME, selects a temporary store with MOLTNET_HOME (the store
// contract every consumer honours before HOME), and points
// MOLTNET_DEFAULT_STORE_ROOT at a directory no test uses, so no test store is
// ever the default store: every keyring namespace is themolt.net/store/<digest>,
// never the real themolt.net. MOLTNET_* credentials and GIT_CONFIG_GLOBAL are
// cleared so a local run matches CI. Go's build and module caches keep their
// real locations so e2e can still build the CLI binary.
//
// It returns the scratch root to remove after the run.
func isolateTestEnvironment() (string, error) {
	realHome = os.Getenv("HOME")
	for _, name := range []string{"GOCACHE", "GOMODCACHE", "GOPATH"} {
		if os.Getenv(name) != "" {
			continue
		}
		out, err := exec.Command("go", "env", name).Output()
		if err != nil {
			return "", fmt.Errorf("resolve %s before relocating HOME: %w", name, err)
		}
		if value := strings.TrimSpace(string(out)); value != "" {
			if err := os.Setenv(name, value); err != nil {
				return "", err
			}
		}
	}

	scratch, err := os.MkdirTemp("", "moltnet-test-env-")
	if err != nil {
		return "", fmt.Errorf("create isolated test environment: %w", err)
	}
	for _, entry := range os.Environ() {
		key, _, found := strings.Cut(entry, "=")
		if !found || !strings.HasPrefix(key, "MOLTNET_") || preservedTestEnv[key] {
			continue
		}
		if err := os.Unsetenv(key); err != nil {
			return scratch, fmt.Errorf("unset %s: %w", key, err)
		}
	}
	if err := os.Unsetenv("GIT_CONFIG_GLOBAL"); err != nil {
		return scratch, fmt.Errorf("unset GIT_CONFIG_GLOBAL: %w", err)
	}
	home := filepath.Join(scratch, "home")
	unusedDefault := filepath.Join(scratch, "default-store-never-used")
	for _, dir := range []string{home, unusedDefault} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return scratch, err
		}
	}
	for name, value := range map[string]string{
		"HOME":                       home,
		"MOLTNET_HOME":               storeUnder(home),
		"MOLTNET_DEFAULT_STORE_ROOT": unusedDefault,
	} {
		if err := os.Setenv(name, value); err != nil {
			return scratch, fmt.Errorf("set %s: %w", name, err)
		}
	}
	if err := os.MkdirAll(storeUnder(home), 0o700); err != nil {
		return scratch, err
	}
	return scratch, nil
}

// storeUnder is where a test HOME keeps its MoltNet store. Fixtures build
// paths under it directly, so MOLTNET_HOME names the same directory.
func storeUnder(home string) string {
	return filepath.Join(home, ".config", "moltnet")
}

// setTestHome gives a test its own HOME and makes that HOME's default store
// the selected one, by clearing the package-wide MOLTNET_HOME that would
// otherwise take precedence. Fixtures assert the default store's lexical paths
// (an explicit MOLTNET_HOME is canonicalized), so they resolve through HOME.
// MOLTNET_DEFAULT_STORE_ROOT still names an unused directory, so this store
// is not the default for keyring purposes and never uses themolt.net.
func setTestHome(t testing.TB, dir string) {
	t.Helper()
	t.Setenv("HOME", dir)
	t.Setenv("MOLTNET_HOME", "")
	if err := os.Unsetenv("MOLTNET_HOME"); err != nil {
		t.Fatalf("unset MOLTNET_HOME: %v", err)
	}
}

// TestTestEnvironmentIsIsolated runs in both the unit and the e2e build and
// fails if either TestMain stops isolating the store.
func TestTestEnvironmentIsIsolated(t *testing.T) {
	tmp, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"HOME", "MOLTNET_HOME", "MOLTNET_DEFAULT_STORE_ROOT"} {
		value, err := filepath.EvalSymlinks(os.Getenv(name))
		if err != nil {
			t.Fatalf("%s=%q does not exist: %v", name, os.Getenv(name), err)
		}
		if !strings.HasPrefix(value, tmp) {
			t.Fatalf("%s=%q is not a temporary directory; tests would touch real MoltNet state", name, value)
		}
	}
	if realHome != "" && os.Getenv("HOME") == realHome {
		t.Fatal("HOME was not relocated")
	}
	if os.Getenv("GIT_CONFIG_GLOBAL") != "" {
		t.Fatal("GIT_CONFIG_GLOBAL survived the scrub")
	}
	service, err := NewSecretProviderRegistry().providers[osKeyringProviderName].(*OSKeyringSecretProvider).secretService()
	if err != nil {
		t.Fatal(err)
	}
	if service == "themolt.net" {
		t.Fatal("the test store resolved to the real default keyring namespace")
	}
}
