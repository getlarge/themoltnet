package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func TestProjectMigration(t *testing.T) {
	for _, kind := range []string{"success", "missing", "team", "diary", "validation", "collision", "remote"} {
		t.Run(kind, func(t *testing.T) {
			dir, source := t.TempDir(), t.TempDir()
			path := filepath.Join(t.TempDir(), "projects.json")
			key := "dir:" + source
			if kind == "remote" {
				key = "git:example/repo"
			}
			data, _ := json.Marshal(contextStore{Version: 1, Contexts: map[string]contextBinding{key: {TeamID: "team", DiaryID: "diary"}}})
			if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
				t.Fatal(err)
			}
			b := projectconfig.Binding{Name: "migrated", APIURL: "https://api.example", TeamID: "team", ProjectID: "project", DiaryID: "diary", Source: source, Strategy: "existing"}
			original := projectconfig.Config{Version: 1, Bindings: []projectconfig.Binding{}}
			if kind == "collision" {
				other := b
				other.ProjectID = "other"
				original.Bindings = append(original.Bindings, other)
			}
			if err := projectconfig.Update(path, func(c *projectconfig.Config) error { *c = original; return nil }); err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(path)
			plan := projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{key: {b}}}
			switch kind {
			case "missing":
				delete(plan.Entries, key)
			case "team":
				plan.Entries[key][0].TeamID = "other"
			case "diary":
				plan.Entries[key][0].DiaryID = "other"
			}
			validate := func(projectconfig.Binding) error {
				if kind == "validation" {
					return errors.New("offline")
				}
				return nil
			}
			err := migrateProjectContexts(dir, path, plan, validate)
			if kind != "success" {
				if err == nil {
					t.Fatal("expected migration failure")
				}
				after, _ := os.ReadFile(path)
				if string(before) != string(after) {
					t.Fatal("destination changed on failure")
				}
				after, _ = os.ReadFile(contextStorePath(dir))
				if string(data) != string(after) {
					t.Fatal("legacy changed on failure")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(contextStorePath(dir)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("legacy retained: %v", err)
			}
			b.Source, _ = filepath.EvalSymlinks(b.Source)
			config, err := projectconfig.Read(path)
			if err != nil || len(config.Bindings) != 1 || !reflect.DeepEqual(config.Bindings[0], b) {
				t.Fatalf("lost registration: %+v %v", config, err)
			}
			if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := migrateProjectContexts(dir, path, plan, validate); err != nil {
				t.Fatal(err)
			}
			config, err = projectconfig.Read(path)
			if err != nil || len(config.Bindings) != 1 {
				t.Fatalf("retry: %+v %v", config, err)
			}
		})
	}
}
func TestContextCommandRemoved(t *testing.T) {
	for _, c := range NewRootCmd("test", "").Commands() {
		if c.Name() == "context" {
			t.Fatal("legacy context command still registered")
		}
	}
}

func TestLegacyMigrationRejectsUnknownData(t *testing.T) {
	dir := t.TempDir()
	data := []byte(`{"version":1,"contexts":{},"unrecognized":{"doNotLose":true}}`)
	if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readContextStore(dir); err == nil {
		t.Fatal("migration reader would silently discard unknown data")
	}
}

func TestMigrationPublishesMultipleEntriesTogether(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "projects.json")
	legacy := contextStore{Version: 1, Contexts: map[string]contextBinding{}}
	plan := projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{}}
	for _, name := range []string{"one", "two"} {
		source := t.TempDir()
		key := "dir:" + source
		legacy.Contexts[key] = contextBinding{TeamID: "team", DiaryID: "diary"}
		plan.Entries[key] = []projectconfig.Binding{{Name: name, TeamID: "team", DiaryID: "diary", ProjectID: "project", APIURL: "https://api.example", Source: source, Strategy: "existing"}}
	}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	err := migrateProjectContexts(dir, path, plan, func(projectconfig.Binding) error {
		calls++
		if calls == 2 {
			return errors.New("second entry failed")
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected failure")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("partial migration published")
	}
	if err := migrateProjectContexts(dir, path, plan, func(projectconfig.Binding) error { return nil }); err != nil {
		t.Fatal(err)
	}
	c, err := projectconfig.Read(path)
	if err != nil || len(c.Bindings) != 2 {
		t.Fatalf("migration lost entry: %+v %v", c, err)
	}
}

func TestMigrationRemoteMapsOnlyExplicitCheckouts(t *testing.T) {
	first := initContextTestRepository(t, "git@example.test:team/repo.git")
	second := initContextTestRepository(t, "https://example.test/team/repo.git")
	unregistered := initContextTestRepository(t, "https://example.test/team/repo.git")
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "projects.json")
	key := "git:example.test/team/repo"
	data, _ := json.Marshal(contextStore{Version: 1, Contexts: map[string]contextBinding{key: {TeamID: "team", DiaryID: "diary"}}})
	if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
		t.Fatal(err)
	}
	plan := projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{}}
	for i, source := range []string{first, second} {
		plan.Entries[key] = append(plan.Entries[key], projectconfig.Binding{Name: fmt.Sprintf("checkout-%d", i), APIURL: "https://api.example", TeamID: "team", DiaryID: "diary", ProjectID: "project", Source: source, Strategy: "existing"})
	}
	if err := migrateProjectContexts(dir, path, plan, func(projectconfig.Binding) error { return nil }); err != nil {
		t.Fatal(err)
	}
	c, err := projectconfig.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	b, err := projectconfig.Resolve(c, projectconfig.Options{ConfigPath: path, CWD: unregistered, Native: true})
	if err != nil || b != nil {
		t.Fatalf("implicitly registered another checkout: %+v %v", b, err)
	}
}

func TestMigrationConcurrentIdentitiesPreserveBindings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		dir, source := t.TempDir(), t.TempDir()
		key := "dir:" + source
		data, _ := json.Marshal(contextStore{Version: 1, Contexts: map[string]contextBinding{key: {TeamID: "team", DiaryID: "diary"}}})
		if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
			t.Fatal(err)
		}
		plan := projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{key: {{Name: fmt.Sprintf("identity-%d", i), APIURL: "https://api.example", TeamID: "team", DiaryID: "diary", ProjectID: "project", Source: source, Strategy: "existing"}}}}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := migrateProjectContexts(dir, path, plan, func(projectconfig.Binding) error { return nil }); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	c, err := projectconfig.Read(path)
	if err != nil || len(c.Bindings) != 2 {
		t.Fatalf("concurrent migration lost data: %+v %v", c, err)
	}
}

func TestMigrationDiscardUnavailableEntry(t *testing.T) {
	dir := t.TempDir()
	key := "dir:/removed/checkout"
	data, _ := json.Marshal(contextStore{Version: 1, Contexts: map[string]contextBinding{key: {TeamID: "unavailable", DiaryID: "diary"}}})
	if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
		t.Fatal(err)
	}
	plan := projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{key: {}}}
	err := migrateProjectContexts(dir, filepath.Join(t.TempDir(), "projects.json"), plan, func(projectconfig.Binding) error {
		t.Fatal("discard must not access the folder or team API")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(contextStorePath(dir)); !os.IsNotExist(err) {
		t.Fatal("legacy remains")
	}
	archived, err := os.ReadFile(contextStorePath(dir) + ".migrated")
	if err != nil || string(archived) != string(data) {
		t.Fatalf("archive lost input: %v", err)
	}
}
func TestMigrationRetryNormalizesEndpointAndSource(t *testing.T) {
	dir, source := t.TempDir(), t.TempDir()
	path := filepath.Join(t.TempDir(), "projects.json")
	key := "dir:" + source
	data, _ := json.Marshal(contextStore{Version: 1, Contexts: map[string]contextBinding{key: {TeamID: "team", DiaryID: "diary"}}})
	b := projectconfig.Binding{Name: "local", APIURL: "https://api.example/", TeamID: "team", DiaryID: "diary", ProjectID: "project", Source: source, Strategy: "existing"}
	plan := projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{key: {b}}}
	for i := 0; i < 2; i++ {
		if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := migrateProjectContexts(dir, path, plan, func(projectconfig.Binding) error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMigrationRejectsArchiveAsDestination(t *testing.T) {
	dir := t.TempDir()
	err := migrateProjectContexts(dir, contextStorePath(dir)+".migrated", projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{}}, func(projectconfig.Binding) error { return nil })
	if err == nil {
		t.Fatal("archive must not overwrite projects")
	}
}
