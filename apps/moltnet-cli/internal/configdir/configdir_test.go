package configdir

import (
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
	for _, row := range strings.Split(string(contents), "\n") {
		if row == "" || strings.HasPrefix(row, "#") {
			continue
		}
		parts := strings.Split(row, "\t")
		actual, err := SecretService(&parts[0])
		if err != nil || actual != "themolt.net/store/"+parts[1] {
			t.Fatalf("service: %q, %v", actual, err)
		}
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
	for _, row := range strings.Split(string(contents), "\n") {
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
