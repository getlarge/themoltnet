package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseChecklistCriteriaRejectsUnsupportedType(t *testing.T) {
	_, err := parseChecklistCriteria([]byte(`{"type":"binary"}`))
	if err == nil {
		t.Fatal("expected unsupported criteria type error")
	}
}

func TestLoadEvalManifest_Vitro(t *testing.T) {
	dir := t.TempDir()
	data := `{"mode":"vitro"}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		t.Fatalf("loadEvalManifest: %v", err)
	}
	if m == nil {
		t.Fatal("expected non-nil manifest")
	}
	if m.Mode != "vitro" {
		t.Errorf("mode: got %q, want vitro", m.Mode)
	}
	if m.Fixture.Ref != "" {
		t.Errorf("fixture.ref should be empty for vitro, got %q", m.Fixture.Ref)
	}
}

func TestLoadEvalManifest_Vivo(t *testing.T) {
	dir := t.TempDir()
	data := `{"mode":"vivo","fixture":{"ref":"abc1234","exclude":["docs/**"]}}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		t.Fatalf("loadEvalManifest: %v", err)
	}
	if m.Mode != "vivo" {
		t.Errorf("mode: got %q, want vivo", m.Mode)
	}
	if m.Fixture.Ref != "abc1234" {
		t.Errorf("fixture.ref: got %q, want abc1234", m.Fixture.Ref)
	}
	if len(m.Fixture.Exclude) != 1 || m.Fixture.Exclude[0] != "docs/**" {
		t.Errorf("fixture.exclude: got %v, want [docs/**]", m.Fixture.Exclude)
	}
}

func TestLoadEvalManifest_Absent(t *testing.T) {
	dir := t.TempDir()

	m, err := loadEvalManifest(dir)
	if err != nil {
		t.Fatalf("expected nil error for absent eval.json, got: %v", err)
	}
	if m != nil {
		t.Errorf("expected nil manifest for absent eval.json, got: %+v", m)
	}
}

func TestLoadEvalManifest_UnknownField(t *testing.T) {
	dir := t.TempDir()
	data := `{"mode":"vitro","unknownField":"value"}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := loadEvalManifest(dir)
	if err == nil {
		t.Fatal("expected error for unknown field in eval.json")
	}
}

func TestLoadEvalManifest_WithPack(t *testing.T) {
	dir := t.TempDir()
	data := `{"mode":"vitro","pack":{"path":"../../packs/my-pack.md"}}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		t.Fatalf("loadEvalManifest: %v", err)
	}
	if m.Pack == nil {
		t.Fatal("expected non-nil pack")
	}
	if m.Pack.Path != "../../packs/my-pack.md" {
		t.Errorf("pack.path: got %q, want ../../packs/my-pack.md", m.Pack.Path)
	}
}

func TestValidateScenario_Valid(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":60},
		{"name":"Does Y","description":"Agent does Y","max_score":40}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(`{"mode":"vitro"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateScenario_CriteriaScoresDontSum100(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":60},
		{"name":"Does Y","description":"Agent does Y","max_score":30}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for scores not summing to 100")
	}
	if !strings.Contains(err.Error(), "sum") {
		t.Errorf("expected 'sum' in error, got: %v", err)
	}
}

func TestValidateScenario_CriteriaEmptyChecklist(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for empty checklist")
	}
	if !strings.Contains(err.Error(), "checklist") {
		t.Errorf("expected 'checklist' in error, got: %v", err)
	}
}

func TestValidateScenario_CriteriaZeroMaxScore(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":0}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for zero max_score")
	}
}

func TestValidateScenario_CriteriaMissingName(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"","description":"Agent does X","max_score":100}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for empty name")
	}
}

func TestValidateScenario_EvalJsonVivoMissingRef(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":100}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(`{"mode":"vivo"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for vivo missing fixture.ref")
	}
	if !strings.Contains(err.Error(), "fixture.ref") {
		t.Errorf("expected 'fixture.ref' in error, got: %v", err)
	}
}

func TestValidateScenario_EvalJsonVitroWithRef(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":100}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(`{"mode":"vitro","fixture":{"ref":"abc123"}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for vitro with fixture.ref")
	}
}

func TestValidateScenario_EvalJsonUnknownMode(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":100}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(`{"mode":"unknown"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for unknown mode")
	}
}

func TestValidateScenario_NoEvalJson_Warning(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":100}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest, err := validateScenario(dir)
	if err != nil {
		t.Fatalf("expected no error for absent eval.json (Phase 1), got: %v", err)
	}
	if manifest != nil {
		t.Errorf("expected nil manifest for absent eval.json, got: %+v", manifest)
	}
}

func TestLoadEvalManifest_WithSolver(t *testing.T) {
	dir := t.TempDir()
	data := `{"mode":"vivo","fixture":{"ref":"abc1234"},"solver":"react"}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		t.Fatalf("loadEvalManifest: %v", err)
	}
	if m.Solver != "react" {
		t.Errorf("solver: got %q, want react", m.Solver)
	}
}

func TestValidateEvalManifest_SolverInvalid(t *testing.T) {
	m := &evalManifest{
		Mode:    "vitro",
		Fixture: evalManifestFixture{},
		Solver:  "bogus",
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for invalid solver kind")
	}
	if !strings.Contains(err.Error(), "solver") {
		t.Errorf("expected 'solver' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_SolverValid(t *testing.T) {
	for _, kind := range []string{"cot", "react", ""} {
		m := &evalManifest{Mode: "vitro", Solver: kind}
		if err := validateEvalManifest(m); err != nil {
			t.Errorf("kind=%q: unexpected error: %v", kind, err)
		}
	}
}

func TestLoadEvalManifest_WithInject(t *testing.T) {
	dir := t.TempDir()
	data := `{"mode":"vitro","fixture":{"inject":[{"from":"fixtures/journal.json","to":"libs/database/drizzle/meta/_journal.json"}]}}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		t.Fatalf("loadEvalManifest: %v", err)
	}
	if len(m.Fixture.Inject) != 1 {
		t.Fatalf("inject: got %d entries, want 1", len(m.Fixture.Inject))
	}
	if m.Fixture.Inject[0].From != "fixtures/journal.json" {
		t.Errorf("inject[0].from: got %q", m.Fixture.Inject[0].From)
	}
	if m.Fixture.Inject[0].To != "libs/database/drizzle/meta/_journal.json" {
		t.Errorf("inject[0].to: got %q", m.Fixture.Inject[0].To)
	}
}

func TestValidateEvalManifest_InjectRejectsAbsoluteTo(t *testing.T) {
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "fixtures/f.json", To: "/etc/passwd"}},
		},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for absolute to path")
	}
	if !strings.Contains(err.Error(), "relative path") {
		t.Errorf("expected 'relative path' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_InjectRejectsDotDot(t *testing.T) {
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "fixtures/f.json", To: "../escape/file.txt"}},
		},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for '..' in to path")
	}
	if !strings.Contains(err.Error(), "..") {
		t.Errorf("expected '..' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_InjectRejectsEmptyFrom(t *testing.T) {
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "", To: "dest/file.json"}},
		},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for empty from")
	}
	if !strings.Contains(err.Error(), "from") {
		t.Errorf("expected 'from' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_InjectRejectsEmptyTo(t *testing.T) {
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "fixtures/f.json", To: ""}},
		},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for empty to")
	}
	if !strings.Contains(err.Error(), "to") {
		t.Errorf("expected 'to' in error, got: %v", err)
	}
}

func TestValidateFixtureInjectSources_RejectsMissingFile(t *testing.T) {
	dir := t.TempDir()
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "fixtures/nonexistent.json", To: "dest/file.json"}},
		},
	}
	err := validateFixtureInjectSources(dir, m)
	if err == nil {
		t.Fatal("expected error for missing inject source file")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected 'not found' in error, got: %v", err)
	}
}

func TestValidateFixtureInjectSources_AcceptsExistingFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "fixtures"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fixtures", "journal.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "fixtures/journal.json", To: "libs/db/meta/_journal.json"}},
		},
	}
	err := validateFixtureInjectSources(dir, m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateEvalManifest_InjectRejectsNonCleanTo(t *testing.T) {
	for _, to := range []string{"a/./b/file.json", "a//b/file.json"} {
		m := &evalManifest{
			Mode: "vitro",
			Fixture: evalManifestFixture{
				Inject: []evalManifestInject{{From: "fixtures/f.json", To: to}},
			},
		}
		err := validateEvalManifest(m)
		if err == nil {
			t.Errorf("expected error for non-clean to path %q", to)
		}
	}
}

func TestValidateEvalManifest_InjectRejectsAbsoluteFrom(t *testing.T) {
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "/etc/passwd", To: "target.json"}},
		},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for absolute from path")
	}
}

func TestValidateEvalManifest_InjectRejectsDotDotInFrom(t *testing.T) {
	m := &evalManifest{
		Mode: "vitro",
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "../escape/secret.json", To: "target.json"}},
		},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for '..' in from path")
	}
}

func TestValidateFixtureInjectSources_RejectsDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "fixtures", "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	m := &evalManifest{
		Fixture: evalManifestFixture{
			Inject: []evalManifestInject{{From: "fixtures/subdir", To: "target/dir"}},
		},
	}
	err := validateFixtureInjectSources(dir, m)
	if err == nil {
		t.Fatal("expected error for directory as inject source")
	}
	if !strings.Contains(err.Error(), "regular file") {
		t.Errorf("expected 'regular file' in error, got: %v", err)
	}
}

func TestValidateScenario_InjectValidation(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[
		{"name":"Does X","description":"Agent does X","max_score":100}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}
	// eval.json with inject pointing to a file that doesn't exist
	eval := `{"mode":"vitro","fixture":{"inject":[{"from":"fixtures/missing.json","to":"target/file.json"}]}}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(eval), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := validateScenario(dir)
	if err == nil {
		t.Fatal("expected error for missing inject source in validateScenario")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected 'not found' in error, got: %v", err)
	}
}

func TestLoadEvalManifest_WithReact(t *testing.T) {
	dir := t.TempDir()
	data := `{"mode":"vivo","fixture":{"ref":"abc1234"},"react":{"max_iterations":15,"bash_timeout_sec":180,"passthrough_env":["GOMODCACHE"],"extra_env":{"NODE_ENV":"test"}}}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		t.Fatalf("loadEvalManifest: %v", err)
	}
	if m.React == nil {
		t.Fatal("expected non-nil react block")
	}
	if m.React.MaxIterations != 15 {
		t.Errorf("max_iterations: got %d, want 15", m.React.MaxIterations)
	}
	if m.React.BashTimeoutSec != 180 {
		t.Errorf("bash_timeout_sec: got %d, want 180", m.React.BashTimeoutSec)
	}
	if len(m.React.PassthroughEnv) != 1 || m.React.PassthroughEnv[0] != "GOMODCACHE" {
		t.Errorf("passthrough_env: got %v, want [GOMODCACHE]", m.React.PassthroughEnv)
	}
	if m.React.ExtraEnv["NODE_ENV"] != "test" {
		t.Errorf("extra_env: got %v, want map[NODE_ENV:test]", m.React.ExtraEnv)
	}
}

func TestValidateEvalManifest_ReactMaxIterationsInvalid(t *testing.T) {
	m := &evalManifest{
		Mode:    "vivo",
		Fixture: evalManifestFixture{Ref: "abc123"},
		React:   &evalManifestReact{MaxIterations: -1},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for negative max_iterations")
	}
	if !strings.Contains(err.Error(), "max_iterations") {
		t.Errorf("expected 'max_iterations' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_ReactBashTimeoutInvalid(t *testing.T) {
	m := &evalManifest{
		Mode:    "vivo",
		Fixture: evalManifestFixture{Ref: "abc123"},
		React:   &evalManifestReact{BashTimeoutSec: -5},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for negative bash_timeout_sec")
	}
	if !strings.Contains(err.Error(), "bash_timeout_sec") {
		t.Errorf("expected 'bash_timeout_sec' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_ReactPassthroughEnvEmpty(t *testing.T) {
	m := &evalManifest{
		Mode:    "vivo",
		Fixture: evalManifestFixture{Ref: "abc123"},
		React:   &evalManifestReact{PassthroughEnv: []string{"GOPATH", ""}},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for empty passthrough_env entry")
	}
	if !strings.Contains(err.Error(), "passthrough_env") {
		t.Errorf("expected 'passthrough_env' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_ReactExtraEnvEmptyKey(t *testing.T) {
	m := &evalManifest{
		Mode:    "vivo",
		Fixture: evalManifestFixture{Ref: "abc123"},
		React:   &evalManifestReact{ExtraEnv: map[string]string{"": "val"}},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for empty extra_env key")
	}
	if !strings.Contains(err.Error(), "extra_env") {
		t.Errorf("expected 'extra_env' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_ReactExtraEnvEmptyValue(t *testing.T) {
	m := &evalManifest{
		Mode:    "vivo",
		Fixture: evalManifestFixture{Ref: "abc123"},
		React:   &evalManifestReact{ExtraEnv: map[string]string{"NODE_ENV": ""}},
	}
	err := validateEvalManifest(m)
	if err == nil {
		t.Fatal("expected error for empty extra_env value")
	}
	if !strings.Contains(err.Error(), "extra_env") {
		t.Errorf("expected 'extra_env' in error, got: %v", err)
	}
}

func TestValidateEvalManifest_ReactValidDefaults(t *testing.T) {
	m := &evalManifest{
		Mode:    "vivo",
		Fixture: evalManifestFixture{Ref: "abc123"},
		React:   &evalManifestReact{},
	}
	if err := validateEvalManifest(m); err != nil {
		t.Fatalf("empty react block should be valid: %v", err)
	}
}

func TestValidateEvalManifest_ReactNilIsValid(t *testing.T) {
	m := &evalManifest{
		Mode:    "vivo",
		Fixture: evalManifestFixture{Ref: "abc123"},
	}
	if err := validateEvalManifest(m); err != nil {
		t.Fatalf("nil react should be valid: %v", err)
	}
}

func TestLoadEvalManifest_RejectsTrailingContent(t *testing.T) {
	dir := t.TempDir()
	body := []byte(`{"mode":"vitro","fixture":{}}{"mode":"vivo"}`)
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := loadEvalManifest(dir)
	if err == nil {
		t.Fatal("expected error for trailing content, got nil")
	}
	if !strings.Contains(err.Error(), "trailing content") {
		t.Errorf("expected trailing-content error, got %v", err)
	}
}
