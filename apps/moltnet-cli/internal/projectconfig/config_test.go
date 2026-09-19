package projectconfig

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestProjectSharedFixtures(t *testing.T) {
	data, err := os.ReadFile("../../../../libs/agent-config/__tests__/fixtures/project-bindings.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name             string
		Config           json.RawMessage
		Options          Options
		Expected         *string
		ExpectedSource   string
		ExpectedApiUrl   string
		ExpectedStrategy string
		Error            bool
		ErrorKind        string
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(root, "source", "nested"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(filepath.Join(root, "source"), filepath.Join(root, "alias")); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(root, "source-other"), 0700); err != nil {
				t.Fatal(err)
			}
			f.Options.ConfigPath = filepath.Join(root, "projects.json")
			f.Options.CWD = filepath.Join(root, f.Options.CWD)
			config, err := Parse(f.Config)
			var result *Binding
			if err == nil {
				result, err = Resolve(config, f.Options)
			}
			if f.Error {
				if err == nil {
					t.Fatal("expected error")
				}
				if errorKind(err) != f.ErrorKind {
					t.Fatalf("expected %s error, got %s: %v", f.ErrorKind, errorKind(err), err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if f.Expected == nil {
				if result != nil {
					t.Fatalf("unexpected result: %+v", result)
				}
				return
			}
			if result == nil || result.Name != *f.Expected {
				t.Fatalf("expected %s, got %+v", *f.Expected, result)
			}
			if f.ExpectedApiUrl != "" && result.APIURL != f.ExpectedApiUrl {
				t.Fatalf("unexpected endpoint: %s", result.APIURL)
			}
			if f.ExpectedStrategy != "" && result.Strategy != f.ExpectedStrategy {
				t.Fatalf("unexpected strategy: %s", result.Strategy)
			}
			if f.ExpectedSource != "" && result.Source != filepath.Join(root, f.ExpectedSource) {
				t.Fatalf("unexpected source %s", result.Source)
			}
		})
	}
}

func TestProjectConcurrentUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	var wg sync.WaitGroup
	for _, name := range []string{"one", "two", "three", "four"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := Update(path, func(c *Config) error {
				c.Bindings = append(c.Bindings, Binding{Name: name, APIURL: "https://api.example", TeamID: "team", ProjectID: "project", Strategy: "none"})
				return nil
			})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	c, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Bindings) != 4 {
		t.Fatalf("lost updates: %+v", c)
	}
}

func TestProjectReadGuards(t *testing.T) {
	for _, kind := range []string{"malformed", "oversized", "directory", "symlink", "writable"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "projects.json")
			var err error
			switch kind {
			case "directory":
				err = os.Mkdir(path, 0700)
			case "symlink":
				err = os.Symlink(filepath.Dir(path), path)
			default:
				content := []byte(`{"version":1,"bindings":[]}`)
				if kind == "malformed" {
					content = []byte("{")
				}
				if kind == "oversized" {
					content = make([]byte, 1048577)
				}
				err = os.WriteFile(path, content, 0600)
				if kind == "writable" {
					if runtime.GOOS == "windows" {
						t.Skip("POSIX modes unavailable")
					}
					err = os.Chmod(path, 0666)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Read(path); err == nil || !strings.Contains(err.Error(), path) {
				t.Fatalf("expected path-bearing read error, got %v", err)
			}
		})
	}
}

func TestProjectUpdateRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := Update(path, func(c *Config) error { return nil }); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	if err := Update(path, func(c *Config) error { c.Version = 2; return nil }); err == nil {
		t.Fatal("expected invalid version")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("failed update changed the file")
	}
}

func TestProjectNumericJSONAndHookClone(t *testing.T) {
	c, err := Parse([]byte(`{"version":1.0,"bindings":[{"name":"local","apiUrl":"https://api.example","teamId":"team","projectId":"project","strategy":"existing","source":".","hooks":{"beforeRun":{"command":"node","args":["original"],"timeoutMs":1e3}}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	result, err := Resolve(c, Options{ConfigPath: filepath.Join(t.TempDir(), "projects.json"), CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	result.Hooks.BeforeRun.Args[0] = "changed"
	if c.Bindings[0].Hooks.BeforeRun.Args[0] != "original" {
		t.Fatal("resolution mutated hooks")
	}
}

func TestProjectCaseInsensitiveVolume(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "CaseDir")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "casedir")); err != nil {
		t.Skip("case-sensitive volume")
	}
	c := &Config{Version: 1, Bindings: []Binding{{Name: "local", APIURL: "https://api.example", TeamID: "team", ProjectID: "project", Source: "CaseDir", Strategy: "existing"}}}
	result, err := Resolve(c, Options{ConfigPath: filepath.Join(root, "projects.json"), CWD: filepath.Join(root, "casedir"), Native: true})
	if err != nil || result == nil {
		t.Fatalf("case alias not resolved: %v", err)
	}
	if filepath.Base(result.Source) != "CaseDir" {
		t.Fatalf("noncanonical case: %s", result.Source)
	}
}

func TestProjectCrossLanguageWriterLock(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "projects.json")
	ready, release := filepath.Join(root, "ready"), filepath.Join(root, "release")
	fixture, err := filepath.Abs("../../../../libs/agent-config/__tests__/fixtures/project-writer.ts")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("node", "--import", "tsx", fixture, path, ready, release)
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(deadline) {
			_ = command.Process.Kill()
			_ = command.Wait()
			t.Fatalf("TS writer not ready: %s", output.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	done := make(chan error, 1)
	go func() {
		done <- Update(path, func(c *Config) error {
			c.Bindings = append(c.Bindings, Binding{Name: "go", APIURL: "https://api.example", TeamID: "team", ProjectID: "project", Strategy: "none"})
			return nil
		})
	}()
	select {
	case err := <-done:
		t.Fatalf("Go writer bypassed TS lock: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := os.WriteFile(release, []byte("release"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err != nil {
		t.Fatalf("TS writer failed: %v %s", err, output.String())
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	c, err := Read(path)
	if err != nil || len(c.Bindings) != 2 || c.Bindings[0].Name != "typescript" || c.Bindings[1].Name != "go" {
		t.Fatalf("lost interop update: %+v %v", c, err)
	}
}

func TestProjectCanonicalWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := Update(path, func(c *Config) error {
		c.Bindings = []Binding{{Name: "local", APIURL: "https://api.example/", TeamID: "team", ProjectID: "project", Strategy: "none"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	c, err := Read(path)
	if err != nil || c.Bindings[0].APIURL != "https://api.example" {
		t.Fatalf("noncanonical endpoint: %+v %v", c, err)
	}
}
