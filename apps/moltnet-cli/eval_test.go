package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()

	// Create task dirs
	taskDir1 := filepath.Join(dir, "task1")
	taskDir2 := filepath.Join(dir, "task2")
	os.MkdirAll(taskDir1, 0o755)
	os.MkdirAll(taskDir2, 0o755)
	os.WriteFile(filepath.Join(taskDir1, "task.md"), []byte("task1"), 0o644)
	os.WriteFile(filepath.Join(taskDir1, "criteria.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(taskDir2, "task.md"), []byte("task2"), 0o644)
	os.WriteFile(filepath.Join(taskDir2, "criteria.json"), []byte("{}"), 0o644)

	// Create pack file
	packPath := filepath.Join(dir, "pack.md")
	os.WriteFile(packPath, []byte("pack content"), 0o644)

	// Write config
	configPath := filepath.Join(dir, "eval.yaml")
	config := "runs:\n  - scenario: task1\n    pack: pack.md\n  - scenario: task2\n"
	os.WriteFile(configPath, []byte(config), 0o644)

	runs, err := loadConfig(configPath)
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if !filepath.IsAbs(runs[0].Scenario) {
		t.Error("scenario path should be absolute")
	}
	if runs[0].Pack == "" {
		t.Error("run 0 should have a pack")
	}
	if runs[1].Pack != "" {
		t.Errorf("run 1 should have no pack, got %q", runs[1].Pack)
	}
}

func TestLoadConfigWithAgentModel(t *testing.T) {
	dir := t.TempDir()

	taskDir := filepath.Join(dir, "task1")
	os.MkdirAll(taskDir, 0o755)
	os.WriteFile(filepath.Join(taskDir, "task.md"), []byte("task"), 0o644)
	os.WriteFile(filepath.Join(taskDir, "criteria.json"), []byte("{}"), 0o644)

	config := `runs:
  - scenario: task1
    agent: codex
    model: openai/gpt-5-codex
  - scenario: task1
`
	configPath := filepath.Join(dir, "eval.yaml")
	os.WriteFile(configPath, []byte(config), 0o644)

	runs, err := loadConfig(configPath)
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if runs[0].Agent != "codex" {
		t.Errorf("run 0 agent: got %q, want codex", runs[0].Agent)
	}
	if runs[0].Model != "openai/gpt-5-codex" {
		t.Errorf("run 0 model: got %q, want openai/gpt-5-codex", runs[0].Model)
	}
	if runs[1].Agent != "" {
		t.Errorf("run 1 agent: got %q, want empty (inherit CLI default)", runs[1].Agent)
	}
	if runs[1].Model != "" {
		t.Errorf("run 1 model: got %q, want empty (inherit CLI default)", runs[1].Model)
	}
}

func TestLoadConfigInvalid(t *testing.T) {
	dir := t.TempDir()

	// Config pointing to missing task dir
	configPath := filepath.Join(dir, "eval.yaml")
	os.WriteFile(configPath, []byte("runs:\n  - scenario: nonexistent\n"), 0o644)

	_, err := loadConfig(configPath)
	if err == nil {
		t.Fatal("expected error for missing task dir")
	}
	if !strings.Contains(err.Error(), "missing task.md") {
		t.Errorf("expected 'missing task.md' error, got: %v", err)
	}
}

func TestValidateAgentModel(t *testing.T) {
	tests := []struct {
		agent string
		model string
		ok    bool
	}{
		{"claude", "anthropic/claude-sonnet-4-6", true},
		{"claude", "anthropic/claude-opus-4-6", true},
		{"claude", "openai/gpt-5-codex", false},
		{"claude", "gpt-5-codex", false},
		{"codex", "openai/gpt-5-codex", true},
		{"codex", "openai/gpt-5-codex-mini", true},
		{"codex", "anthropic/claude-sonnet-4-6", false},
		{"codex", "claude-sonnet-4-6", false},
	}
	for _, tt := range tests {
		err := validateAgentModel(tt.agent, tt.model)
		if tt.ok && err != nil {
			t.Errorf("validateAgentModel(%q, %q) = %v, want nil", tt.agent, tt.model, err)
		}
		if !tt.ok && err == nil {
			t.Errorf("validateAgentModel(%q, %q) = nil, want error", tt.agent, tt.model)
		}
	}
}

func TestValidateEvalEngine(t *testing.T) {
	tests := []struct {
		engine string
		ok     bool
	}{
		{"dspy", true},
		{"", true},
		{"harbor", false},
		{"nope", false},
	}

	for _, tt := range tests {
		err := validateEvalEngine(tt.engine)
		if tt.ok && err != nil {
			t.Errorf("validateEvalEngine(%q) = %v, want nil", tt.engine, err)
		}
		if !tt.ok && err == nil {
			t.Errorf("validateEvalEngine(%q) = nil, want error", tt.engine)
		}
	}
}

func TestValidateJudgeModel(t *testing.T) {
	tests := []struct {
		judge string
		model string
		ok    bool
	}{
		{"claude", "claude-sonnet-4-6", true},
		{"claude", "claude-opus-4-6", true},
		{"claude", "gpt-5-codex", false},
		{"codex", "gpt-5-codex", true},
		{"codex", "gpt-5-codex-mini", true},
		{"codex", "claude-sonnet-4-6", false},
	}
	for _, tt := range tests {
		err := validateJudgeModel(tt.judge, tt.model)
		if tt.ok && err != nil {
			t.Errorf("validateJudgeModel(%q, %q) = %v, want nil", tt.judge, tt.model, err)
		}
		if !tt.ok && err == nil {
			t.Errorf("validateJudgeModel(%q, %q) = nil, want error", tt.judge, tt.model)
		}
	}
}

func TestDefaultModel(t *testing.T) {
	if got := defaultAgentModel("claude"); got != "anthropic/claude-sonnet-4-6" {
		t.Errorf("defaultAgentModel(claude) = %q", got)
	}
	if got := defaultAgentModel("codex"); got != "openai/gpt-5-codex" {
		t.Errorf("defaultAgentModel(codex) = %q", got)
	}
	if got := defaultJudgeModel("claude"); got != "claude-sonnet-4-6" {
		t.Errorf("defaultJudgeModel(claude) = %q", got)
	}
	if got := defaultJudgeModel("codex"); got != "gpt-5-codex" {
		t.Errorf("defaultJudgeModel(codex) = %q", got)
	}
}

func TestGroupRunsByAgentModel(t *testing.T) {
	inputs := []evalRunInput{
		{name: "task1", agent: "claude", model: "anthropic/claude-sonnet-4-6"},
		{name: "task2", agent: "claude", model: "anthropic/claude-sonnet-4-6"},
		{name: "task3", agent: "codex", model: "openai/gpt-5-codex"},
		{name: "task4", agent: "claude", model: "anthropic/claude-opus-4-6"},
	}

	groups := groupRunsByAgentModel(inputs)

	if len(groups) != 3 {
		t.Fatalf("expected 3 groups, got %d", len(groups))
	}

	keys := make([]string, 0, len(groups))
	for _, g := range groups {
		keys = append(keys, g.agent+"/"+g.model)
	}
	for i := 1; i < len(keys); i++ {
		if keys[i] < keys[i-1] {
			t.Errorf("groups not sorted: %v", keys)
			break
		}
	}

	for _, g := range groups {
		if g.agent == "claude" && g.model == "anthropic/claude-sonnet-4-6" {
			if len(g.inputs) != 2 {
				t.Errorf("claude-sonnet group: expected 2 inputs, got %d", len(g.inputs))
			}
		}
	}
}

func TestPrintSummary(t *testing.T) {
	// Just verify it doesn't panic
	results := []evalResult{
		{
			taskName:       "test-task",
			withoutContext: &trialScores{reward: 0.2},
			withContext:    &trialScores{reward: 0.8, details: map[string]float64{"criterion_a": 0.8}},
		},
	}
	printSummary(results, "claude-sonnet-4-6")

	// Batch mode
	results = append(results, evalResult{
		taskName:       "other-task",
		withoutContext: &trialScores{reward: 0.5},
	})
	printSummary(results, "claude-sonnet-4-6")
}

func TestPrintSingleSummaryUsesAbsoluteLogDir(t *testing.T) {
	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w
	t.Cleanup(func() {
		os.Stdout = oldStdout
	})

	printSingleSummary(evalResult{
		taskName: "test-task",
		withoutContext: &trialScores{
			reward: 0,
			err:    "NonZeroAgentExitCodeError",
			logDir: "/tmp/moltnet-eval/jobs/test-task__abc123",
		},
	}, "")

	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatalf("read captured stdout: %v", err)
	}

	got := buf.String()
	if !strings.Contains(got, "Logs: /tmp/moltnet-eval/jobs/test-task__abc123/") {
		t.Fatalf("expected absolute log path in summary, got %q", got)
	}
}

func TestPrintRunPaths(t *testing.T) {
	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w
	t.Cleanup(func() {
		os.Stdout = oldStdout
	})

	printRunPaths("/tmp/moltnet-eval/jobs/2026-04-01__14-57-01")

	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatalf("read captured stdout: %v", err)
	}

	got := buf.String()
	if !strings.Contains(got, "Run output: /tmp/moltnet-eval/jobs/2026-04-01__14-57-01") {
		t.Fatalf("missing run output path, got %q", got)
	}
	if !strings.Contains(got, "Result file: /tmp/moltnet-eval/jobs/2026-04-01__14-57-01/result.json") {
		t.Fatalf("missing result file path, got %q", got)
	}
}

func TestGroupHeaderLine(t *testing.T) {
	group := runGroup{
		agent: "codex",
		model: "openai/gpt-5-codex",
		inputs: []evalRunInput{
			{name: "task-a"},
			{name: "task-b"},
		},
	}

	got := groupHeaderLine(1, 3, group)
	want := "Group 2/3: agent=codex model=openai/gpt-5-codex (2 task(s))"
	if got != want {
		t.Fatalf("groupHeaderLine() = %q, want %q", got, want)
	}
}

func TestEvalRunCompletionError(t *testing.T) {
	results := []evalResult{{taskName: "task"}}

	if err := evalRunCompletionError(nil, false); err == nil || !strings.Contains(err.Error(), "no results found") {
		t.Fatalf("expected no-results error, got %v", err)
	}

	if err := evalRunCompletionError(results, true); err == nil || !strings.Contains(err.Error(), "one or more trials reported errors") {
		t.Fatalf("expected trial-error failure, got %v", err)
	}

	if err := evalRunCompletionError(results, false); err != nil {
		t.Fatalf("expected nil error on clean completion, got %v", err)
	}
}

func TestResolveEvalRun_LoadsManifest(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(`{"mode":"vitro"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	input, err := resolveEvalRun(dir, "", "claude", "anthropic/claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("resolveEvalRun: %v", err)
	}
	if input.manifest == nil {
		t.Fatal("expected non-nil manifest in evalRunInput")
	}
	if input.manifest.Mode != "vitro" {
		t.Errorf("manifest.mode: got %q, want vitro", input.manifest.Mode)
	}
}

func TestResolveEvalRun_NoManifestWarns(t *testing.T) {
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
	// No eval.json

	input, err := resolveEvalRun(dir, "", "claude", "anthropic/claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("resolveEvalRun: %v", err)
	}
	if input.manifest != nil {
		t.Errorf("expected nil manifest for absent eval.json, got: %+v", input.manifest)
	}
}

func TestResolveEvalRun_ManifestPackPathResolved(t *testing.T) {
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
	packPath := filepath.Join(dir, "pack.md")
	if err := os.WriteFile(packPath, []byte("# Pack Content"), 0o644); err != nil {
		t.Fatal(err)
	}
	evalJSON := `{"mode":"vitro","pack":{"path":"pack.md"}}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(evalJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	input, err := resolveEvalRun(dir, "", "claude", "anthropic/claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("resolveEvalRun: %v", err)
	}
	if input.packMD != "# Pack Content" {
		t.Errorf("packMD: got %q, want pack content", input.packMD)
	}
}

func TestResolveEvalRun_CLIPackOverridesManifest(t *testing.T) {
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
	manifestPack := filepath.Join(dir, "manifest-pack.md")
	cliPack := filepath.Join(dir, "cli-pack.md")
	if err := os.WriteFile(manifestPack, []byte("manifest pack"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cliPack, []byte("cli pack"), 0o644); err != nil {
		t.Fatal(err)
	}
	evalJSON := `{"mode":"vitro","pack":{"path":"manifest-pack.md"}}`
	if err := os.WriteFile(filepath.Join(dir, "eval.json"), []byte(evalJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	input, err := resolveEvalRun(dir, cliPack, "claude", "anthropic/claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("resolveEvalRun: %v", err)
	}
	if input.packMD != "cli pack" {
		t.Errorf("CLI --pack should override eval.json pack, got: %q", input.packMD)
	}
}

func TestEvalRunCmd_FixtureRefRequiresVivo(t *testing.T) {
	cmd := newEvalRunCmd()
	cmd.SetArgs([]string{"--scenario", "x", "--mode", "vitro", "--fixture-ref", "abc"})
	cmd.SetOut(new(bytes.Buffer))
	cmd.SetErr(new(bytes.Buffer))
	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected error when --fixture-ref used with --mode vitro")
	}
	if !strings.Contains(err.Error(), "requires --mode vivo") {
		t.Errorf("expected 'requires --mode vivo' error, got %v", err)
	}
}

func TestEvalRunCmd_ModeFlagParsed(t *testing.T) {
	cmd := newEvalRunCmd()
	if f := cmd.Flags().Lookup("mode"); f == nil {
		t.Fatal("expected --mode flag to exist")
	}
	if f := cmd.Flags().Lookup("fixture-ref"); f == nil {
		t.Fatal("expected --fixture-ref flag to exist")
	}
}

func TestLoadConfig_JSON(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "scenario-0")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatal(err)
	}
	criteria := `{"type":"weighted_checklist","checklist":[{"name":"X","description":"Does X","max_score":100}]}`
	if err := os.WriteFile(filepath.Join(taskDir, "criteria.json"), []byte(criteria), 0o644); err != nil {
		t.Fatal(err)
	}

	config := `{"runs":[{"scenario":"scenario-0"}]}`
	configPath := filepath.Join(dir, "batch.json")
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}

	runs, err := loadConfig(configPath)
	if err != nil {
		t.Fatalf("loadConfig (JSON): %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	if runs[0].Scenario == "" {
		t.Error("expected scenario to be populated")
	}
}
