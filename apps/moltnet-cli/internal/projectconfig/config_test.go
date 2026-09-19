package projectconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestProjectSharedFixtures(t *testing.T) {
	data, err := os.ReadFile("../../../../libs/agent-config/__tests__/fixtures/project-bindings.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name           string
		Config         json.RawMessage
		Options        Options
		Expected       *string
		ExpectedSource string
		Error          bool
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
