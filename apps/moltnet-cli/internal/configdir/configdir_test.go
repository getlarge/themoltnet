package configdir

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSecretServiceConformance(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX root fixtures")
	}
	contents, err := os.ReadFile("../../../../test-fixtures/store-secret-service-conformance.tsv")
	if err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(contents)))
	for scanner.Scan() {
		row := scanner.Text()
		if row == "" || strings.HasPrefix(row, "#") {
			continue
		}
		parts := strings.Split(row, "\t")
		actual, err := SecretService(&parts[0])
		if err != nil || actual != "themolt.net/store/"+parts[1] {
			t.Fatalf("service: %q, %v", actual, err)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
}

func TestConformance(t *testing.T) {
	contents, err := os.ReadFile("../../../../test-fixtures/store-root-conformance.tsv")
	if err != nil {
		t.Fatal(err)
	}
	cwd, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Chdir(cwd)
	fixture := strings.ReplaceAll(string(contents), "\r\n", "\n")
	for _, ending := range []string{"\n", "\r\n"} {
		t.Run(fmt.Sprintf("line-ending-%q", ending), func(t *testing.T) {
			scanner := bufio.NewScanner(strings.NewReader(strings.ReplaceAll(fixture, "\n", ending)))
			for scanner.Scan() {
				row := scanner.Text()
				if row == "" || strings.HasPrefix(row, "#") {
					continue
				}
				parts := strings.Split(row, "\t")
				root := parts[0]
				got, err := Resolve(&root)
				if parts[1] == "ERROR" {
					if err == nil {
						t.Errorf("accepted invalid root %q", root)
					}
				} else if err != nil || got != filepath.Join(cwd, parts[1]) {
					t.Errorf("%q => %q, %v", root, got, err)
				}
			}
			if err := scanner.Err(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSecretNamespaces(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	defaultRoot := filepath.Join(home, ".config", "moltnet")
	if err := os.MkdirAll(defaultRoot, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(home, "alias")
	if err := os.Symlink(defaultRoot, alias); err != nil {
		t.Fatal(err)
	}
	service, err := SecretService(&alias)
	if err != nil || service != "themolt.net" {
		t.Fatalf("default alias: %q, %v", service, err)
	}
	a, b := filepath.Join(home, "a"), filepath.Join(home, "b")
	first, err := SecretService(&a)
	if err != nil {
		t.Fatal(err)
	}
	second, err := SecretService(&b)
	if err != nil || first == second || first == service {
		t.Fatalf("isolated services: %q, %q, %v", first, second, err)
	}
	t.Setenv("MOLTNET_HOME", "")
	if got, err := Resolve(&a); err != nil || got != a {
		t.Fatalf("explicit precedence: %q, %v", got, err)
	}
}

func TestStoreOverride(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(parent, "store")
	t.Setenv("MOLTNET_HOME", root)
	got, err := Dir()
	if err != nil || got != root {
		t.Fatalf("Dir() = %q, %v; want %q", got, err, root)
	}
}

func TestLegacyStoreRootConflict(t *testing.T) {
	t.Setenv("MOLTNET_HOME", filepath.Join(t.TempDir(), "a"))
	t.Setenv("MOLTNET_AGENT_SERVER_ROOT", filepath.Join(t.TempDir(), "b"))
	if _, err := Dir(); err == nil {
		t.Fatal("conflicting root aliases accepted")
	}
	explicit := t.TempDir()
	if _, err := Resolve(&explicit); err != nil {
		t.Fatalf("explicit override: %v", err)
	}
}

func TestEmptyStoreRejected(t *testing.T) {
	t.Setenv("MOLTNET_HOME", "")
	if _, err := Dir(); err == nil {
		t.Fatal("empty root accepted")
	}
}

func TestStoreAlias(t *testing.T) {
	home := t.TempDir()
	real := filepath.Join(home, "real")
	alias := filepath.Join(home, "alias")
	if err := os.Mkdir(real, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, alias); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MOLTNET_HOME", filepath.Join(alias, "missing"))
	expected, err := filepath.EvalSymlinks(real)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Dir()
	if err != nil || got != filepath.Join(expected, "missing") {
		t.Fatalf("Dir() = %q, %v", got, err)
	}
}

func TestOnDiskCase(t *testing.T) {
	root := t.TempDir()
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	actual := filepath.Join(canonical, "CaseStore")
	if err := os.Mkdir(actual, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(canonical, "casestore")
	if _, err := os.Stat(alias); err != nil {
		t.Skip("case-sensitive filesystem")
	}
	got, err := Canonical(alias)
	if err != nil || got != actual {
		t.Fatalf("case alias: %q, %v; want %q", got, err, actual)
	}
}
func TestLexicalDefault(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	actual := filepath.Join(root, "actual")
	if err := os.MkdirAll(filepath.Join(actual, ".config", "moltnet"), 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(actual, alias); err != nil {
		t.Skip(err)
	}
	t.Setenv("HOME", alias)
	t.Setenv("USERPROFILE", alias)
	t.Setenv("MOLTNET_HOME", "")
	os.Unsetenv("MOLTNET_HOME")
	got, err := Dir()
	if err != nil || got != filepath.Join(alias, ".config", "moltnet") {
		t.Fatalf("default: %q, %v", got, err)
	}
}

func TestSymlinkBeforeParent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permission")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "real/nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "real/nested"), filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	got, err := Canonical(root + "/link/../new")
	expected, _ := Canonical(filepath.Join(root, "real/new"))
	if err != nil || got != expected {
		t.Fatalf("got %q, %v; want %q", got, err, expected)
	}
}

func TestBrokenDefaultDoesNotAffectIsolatedNamespace(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("MOLTNET_HOME", "")
	os.Unsetenv("MOLTNET_HOME")
	if err := os.WriteFile(filepath.Join(home, ".config"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := Dir(); err != nil || got != filepath.Join(home, ".config", "moltnet") {
		t.Fatalf("default lookup: %q, %v", got, err)
	}
	if got, err := SecretService(nil); err != nil || got != SecretServiceName {
		t.Fatalf("default service: %q, %v", got, err)
	}
	root := filepath.Join(home, "isolated")
	if got, err := SecretService(&root); err != nil || !strings.HasPrefix(got, SecretServiceName+"/store/") {
		t.Fatalf("isolated service: %q, %v", got, err)
	}
}

func TestRelativeHomeDefaultStaysLexical(t *testing.T) {
	t.Setenv("HOME", "relative-home")
	t.Setenv("USERPROFILE", "relative-home")
	t.Setenv("MOLTNET_HOME", "ignored")
	os.Unsetenv("MOLTNET_HOME")
	got, err := Resolve(nil)
	if err != nil || got != filepath.Join("relative-home", ".config", "moltnet") {
		t.Fatalf("relative default: %q, %v", got, err)
	}
}

func TestIsolatedCacheDir(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MOLTNET_HOME", root)
	got, err := CacheDir()
	canonical, _ := Canonical(root)
	if err != nil || got != filepath.Join(canonical, "cache") {
		t.Fatalf("cache: %q, %v", got, err)
	}
}

func TestDefaultStoreAliasKeepsCacheLocation(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("MOLTNET_HOME", "")
	os.Unsetenv("MOLTNET_HOME")
	t.Setenv("MOLTNET_AGENT_SERVER_ROOT", "")
	os.Unsetenv("MOLTNET_AGENT_SERVER_ROOT")
	expected, err := CacheDir()
	if err != nil {
		t.Fatal(err)
	}
	root, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("MOLTNET_HOME", root)
	got, err := CacheDir()
	if err != nil || got != expected {
		t.Fatalf("alias cache %q, %v; want %q", got, err, expected)
	}
}

func TestIsolatedCacheWithBrokenDefault(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	if err := os.WriteFile(filepath.Join(home, ".config"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(home, "isolated")
	t.Setenv("MOLTNET_HOME", root)
	expected, err := Canonical(root)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := CacheDir(); err != nil || got != filepath.Join(expected, "cache") {
		t.Fatalf("cache: %q, %v", got, err)
	}
}

func TestFullStoreAliasConformance(t *testing.T) {
	contents, err := os.ReadFile("../../../../test-fixtures/store-alias-conformance.tsv")
	if err != nil {
		t.Fatal(err)
	}
	cwd, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Chdir(cwd)
	for _, row := range strings.Split(string(contents), "\n") {
		if row == "" || strings.HasPrefix(row, "#") {
			continue
		}
		t.Run(row, func(t *testing.T) {
			parts := strings.Split(row, "\t")
			for i, name := range []string{"MOLTNET_HOME", "MOLTNET_AGENT_SERVER_ROOT"} {
				t.Setenv(name, parts[i])
				if parts[i] == "UNSET" {
					os.Unsetenv(name)
				}
			}
			got, err := Dir()
			service, serviceErr := SecretService(nil)
			if parts[2] == "ERROR" {
				if err == nil || serviceErr == nil {
					t.Fatalf("accepted invalid selection: %q", row)
				}
			} else {
				expected := filepath.Join(cwd, parts[2])
				expectedService, _ := SecretService(&expected)
				if err != nil || got != expected || serviceErr != nil || service != expectedService {
					t.Fatalf("selection: %q, %v; service: %q, %v", got, err, service, serviceErr)
				}
			}
		})
	}
}
