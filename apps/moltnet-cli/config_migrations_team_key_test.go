package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func teamKeyMigrationFixture(t *testing.T, identityScoped bool) (string, *SecretProviderRegistry, *memorySecretProvider, []configMigration) {
	t.Helper()
	const subject = "00000000-0000-4000-8000-000000000111"
	const team = "00000000-0000-4000-8000-000000000222"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agents/whoami" {
			t.Errorf("unexpected credential request %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer exact-legacy" {
			t.Error("migration selected a different credential")
		}
		binding := map[string]any{"bindingScope": "team", "boundTeamId": team, "keyId": "old-key"}
		if identityScoped {
			binding = map[string]any{"bindingScope": "identity", "keyId": "old-key"}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"subjectId": subject, "subjectType": "agent", "identityId": subject, "publicKey": "ed25519:public", "fingerprint": "fingerprint", "scopes": []string{"agent:profile"}, "credentialBinding": binding}); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[AgentKeyKey(subject)] = "exact-legacy"
	path := filepath.Join(t.TempDir(), "moltnet.json")
	data, err := json.Marshal(map[string]any{"subject_id": subject, "subject_type": "agent", "agent_key_ref": SecretReference{Provider: osKeyringProviderName, Key: AgentKeyKey(subject)}, "endpoints": map[string]string{"api": server.URL}, "extension": map[string]bool{"preserved": true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path, registry, provider, []configMigration{newTeamKeyIndexMigration(osKeyringProviderName)}
}

func TestTeamKeyMigrationStalePlanAndConflicts(t *testing.T) {
	for _, scenario := range []string{"stale", "destination"} {
		t.Run(scenario, func(t *testing.T) {
			path, registry, provider, migrations := teamKeyMigrationFixture(t, false)
			plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
			if err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "stale" {
				before = append(before, ' ')
				if err := os.WriteFile(path, before, 0o600); err != nil {
					t.Fatal(err)
				}
			} else {
				provider.values[TeamAgentKeyKey("00000000-0000-4000-8000-000000000111", "00000000-0000-4000-8000-000000000222")] = "different-existing-key"
			}
			if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations); err == nil {
				t.Fatal("expected safe rejection")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(before) != string(after) {
				t.Fatal("failure changed usable previous config")
			}
			if provider.values[AgentKeyKey("00000000-0000-4000-8000-000000000111")] != "exact-legacy" {
				t.Fatal("original credential changed")
			}
		})
	}
}

func TestTeamKeyMigrationRecoversAfterCopiedSecretAndFailedConfigWrite(t *testing.T) {
	path, registry, provider, migrations := teamKeyMigrationFixture(t, false)
	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a concurrent non-cooperating writer between secret copy and CAS.
	provider.failSet = func(string) error { return os.WriteFile(path, append(before, ' '), 0o600) }
	if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations); err == nil {
		t.Fatal("expected stale config rejection")
	}
	provider.failSet = nil
	copied := TeamAgentKeyKey("00000000-0000-4000-8000-000000000111", "00000000-0000-4000-8000-000000000222")
	if provider.values[copied] != "exact-legacy" {
		t.Fatal("copy should remain recoverable")
	}
	plan, err = buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations); err != nil {
		t.Fatal(err)
	}
	plan, err = buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil || len(plan.Migrations) != 0 {
		t.Fatalf("repeat migration: %v %v", plan, err)
	}
}

func TestTeamKeyMigrationIdentityFallbackAndProviderFailure(t *testing.T) {
	t.Run("identity", func(t *testing.T) {
		path, registry, _, migrations := teamKeyMigrationFixture(t, true)
		plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations); err != nil {
			t.Fatal(err)
		}
		config, err := ReadConfigFrom(path)
		if err != nil {
			t.Fatal(err)
		}
		if config.AgentKeyRef == nil || len(config.AgentKeyRefs) != 0 {
			t.Fatal("identity key was narrowed without enrollment")
		}
		plan, err = buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
		if err != nil || len(plan.Migrations) != 0 {
			t.Fatal("identity fallback migration repeated")
		}
	})
	t.Run("provider", func(t *testing.T) {
		path, registry, provider, migrations := teamKeyMigrationFixture(t, false)
		provider.failSet = func(string) error { return errors.New("injected exact-legacy") }
		plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
		if err != nil {
			t.Fatal(err)
		}
		_, err = applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations)
		if err == nil || strings.Contains(err.Error(), "exact-legacy") {
			t.Fatal("provider error leaked or did not fail")
		}
	})
}
