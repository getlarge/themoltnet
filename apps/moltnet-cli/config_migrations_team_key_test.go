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

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

func teamKeyMigrationFixture(t *testing.T, identityScoped bool, changeBinding ...func(map[string]any)) (string, *SecretProviderRegistry, *memorySecretProvider, []configMigration) {
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
		for _, change := range changeBinding {
			change(binding)
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

func TestTeamKeyMigrationRechecksCheckpointDependencies(t *testing.T) {
	for _, field := range []string{"provider", "key", "subjectId", "reference", "keyId", "bindingScope", "teamId", "malformed"} {
		t.Run(field, func(t *testing.T) {
			path, registry, _, migrations := teamKeyMigrationFixture(t, false)
			plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var doc map[string]any
			if err = json.Unmarshal(raw, &doc); err != nil {
				t.Fatal(err)
			}
			const team = "00000000-0000-4000-8000-000000000222"
			checkpoint := doc["agent_key_ref_verified"].(map[string]any)
			switch field {
			case "provider", "key":
				doc["agent_key_refs"].(map[string]any)[team].(map[string]any)[field] = "changed"
			case "reference":
				checkpoint[field] = map[string]string{"provider": "file", "key": "changed"}
			case "malformed":
				doc["agent_key_ref_verified"] = "broken"
			default:
				checkpoint[field] = ""
			}
			raw, err = json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			plan, err = buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
			if field == "malformed" {
				if err == nil {
					t.Fatal("malformed checkpoint accepted")
				}
				return
			}
			if err != nil || len(plan.Migrations) != 1 {
				t.Fatalf("checkpoint incorrectly suppressed migration: %v %v", plan, err)
			}
			_, err = applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations)
			if field == "provider" || field == "key" {
				if err == nil {
					t.Fatal("conflicting reference overwritten")
				}
				after, _ := os.ReadFile(path)
				if string(after) != string(raw) {
					t.Fatal("rejected repair changed config")
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}

type unverifiedTeamCopyProvider struct {
	*memorySecretProvider
	copied bool
}

func (p *unverifiedTeamCopyProvider) Set(key, value string) error {
	p.copied = true
	return p.memorySecretProvider.Set(key, value)
}
func (p *unverifiedTeamCopyProvider) Get(key string) (string, error) {
	if p.copied && strings.Count(key, "/") == 2 {
		return "", errors.New("read-back unavailable")
	}
	return p.memorySecretProvider.Get(key)
}
func TestTeamKeyMigrationUnverifiedCopyRequiresRecovery(t *testing.T) {
	path, registry, provider, migrations := teamKeyMigrationFixture(t, false)
	registry.Register(osKeyringProviderName, &unverifiedTeamCopyProvider{memorySecretProvider: provider})
	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	_, err = applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations)
	var stage *configmigrate.StageError
	if !errors.As(err, &stage) || stage.Stage != "ensure_destination" || stage.Retryable || !stage.Changed || !stage.ManualRecoveryRequired {
		t.Fatalf("wrong partial-write classification: %v", err)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("unverified copy changed config")
	}
}

func TestTeamKeyMigrationRejectsIncompleteBindingAtVerification(t *testing.T) {
	for _, scenario := range []string{"team-id", "team-key", "identity-key"} {
		t.Run(scenario, func(t *testing.T) {
			path, registry, _, migrations := teamKeyMigrationFixture(t, scenario == "identity-key", func(binding map[string]any) {
				if scenario == "team-id" {
					binding["boundTeamId"] = "00000000-0000-0000-0000-000000000000"
				} else {
					binding["keyId"] = ""
				}
			})
			plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
			if err != nil {
				t.Fatal(err)
			}
			_, err = applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations)
			var stage *configmigrate.StageError
			if !errors.As(err, &stage) || stage.Stage != "verify_binding" || stage.Retryable || stage.Changed {
				t.Fatalf("wrong binding failure: %v", err)
			}
		})
	}
}
