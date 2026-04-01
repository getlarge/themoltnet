package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderTaskToml(t *testing.T) {
	data := templateData{
		JudgeSDK:          "claude",
		JudgeModelDefault: "claude-sonnet-4-6",
	}
	got, err := renderTemplate(taskTomlTmpl, data)
	if err != nil {
		t.Fatalf("renderTemplate: %v", err)
	}
	if !strings.Contains(got, `JUDGE_SDK = "claude"`) {
		t.Error("should contain JUDGE_SDK = claude")
	}
	if !strings.Contains(got, "ANTHROPIC_API_KEY") {
		t.Error("should contain ANTHROPIC_API_KEY for claude judge")
	}
	if strings.Contains(got, "OPENAI_API_KEY") {
		t.Error("should not contain OPENAI_API_KEY for claude judge")
	}
}

func TestRenderTaskTomlCodex(t *testing.T) {
	data := templateData{
		JudgeSDK:          "codex",
		JudgeModelDefault: "gpt-5-codex",
	}
	got, err := renderTemplate(taskTomlTmpl, data)
	if err != nil {
		t.Fatalf("renderTemplate: %v", err)
	}
	if !strings.Contains(got, `JUDGE_SDK = "codex"`) {
		t.Error("should contain JUDGE_SDK = codex")
	}
	if !strings.Contains(got, "OPENAI_API_KEY") {
		t.Error("should contain OPENAI_API_KEY for codex judge")
	}
	if !strings.Contains(got, `CODEX_HOME = "/home/agent/.codex"`) {
		t.Error("should contain shared CODEX_HOME for codex judge")
	}
	if strings.Contains(got, "ANTHROPIC_API_KEY") {
		t.Error("should not contain ANTHROPIC_API_KEY for codex judge")
	}
}

func TestRenderTestSh(t *testing.T) {
	data := templateData{JudgeSDK: "claude"}
	got, err := renderTemplate(testShTmpl, data)
	if err != nil {
		t.Fatalf("renderTemplate: %v", err)
	}
	if !strings.Contains(got, "judge.js") {
		t.Error("claude judge should use judge.js")
	}
	if strings.Contains(got, "judge-codex.js") {
		t.Error("claude judge should not reference judge-codex.js")
	}

	data.JudgeSDK = "codex"
	got, err = renderTemplate(testShTmpl, data)
	if err != nil {
		t.Fatalf("renderTemplate: %v", err)
	}
	if !strings.Contains(got, "judge-codex.js") {
		t.Error("codex judge should use judge-codex.js")
	}
}

func TestScaffoldTask(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task")

	taskMD := []byte("# Test Task\nDo something.")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	tmplData := templateData{JudgeSDK: "claude", JudgeModelDefault: "claude-sonnet-4-6"}

	if err := scaffoldTask(taskDir, taskMD, criteria, "", false, tmplData, "claude"); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	// Verify directory structure
	for _, path := range []string{
		"task.toml",
		"instruction.md",
		"environment/Dockerfile",
		"environment/judge/judge.js",
		"environment/judge/judge-codex.js",
		"environment/judge/package.json",
		"tests/criteria.json",
		"tests/test.sh",
	} {
		full := filepath.Join(taskDir, path)
		if _, err := os.Stat(full); err != nil {
			t.Errorf("missing %s: %v", path, err)
		}
	}

	// Verify no .claude dir without context
	claudeDir := filepath.Join(taskDir, "environment", ".claude")
	if _, err := os.Stat(claudeDir); err == nil {
		t.Error(".claude dir should not exist without context")
	}

	// Verify instruction.md content
	got, _ := os.ReadFile(filepath.Join(taskDir, "instruction.md"))
	if string(got) != string(taskMD) {
		t.Errorf("instruction.md: got %q, want %q", got, taskMD)
	}

	// Verify test.sh is executable
	info, _ := os.Stat(filepath.Join(taskDir, "tests", "test.sh"))
	if info.Mode()&0o111 == 0 {
		t.Error("test.sh should be executable")
	}

	dockerfile, _ := os.ReadFile(filepath.Join(taskDir, "environment", "Dockerfile"))
	if !strings.Contains(string(dockerfile), "FROM docker/sandbox-templates:claude-code") {
		t.Error("claude agent should scaffold the claude sandbox image")
	}
}

func TestScaffoldTaskWithContext(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task-ctx")

	taskMD := []byte("# Test Task")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	packMD := "## My Pack\n\nSome context here."

	tmplData := templateData{JudgeSDK: "claude", JudgeModelDefault: "claude-sonnet-4-6"}
	if err := scaffoldTask(taskDir, taskMD, criteria, packMD, true, tmplData, "claude"); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	claudePath := filepath.Join(taskDir, "environment", ".claude", "CLAUDE.md")
	got, err := os.ReadFile(claudePath)
	if err != nil {
		t.Fatalf("reading CLAUDE.md: %v", err)
	}
	if !strings.Contains(string(got), packMD) {
		t.Errorf("CLAUDE.md should contain pack markdown, got: %s", got)
	}
}

func TestScaffoldTaskCodexJudge(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task-codex")

	taskMD := []byte("# Test Task")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	tmplData := templateData{JudgeSDK: "codex", JudgeModelDefault: "gpt-5-codex"}

	if err := scaffoldTask(taskDir, taskMD, criteria, "", false, tmplData, "codex"); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	codexJudgePath := filepath.Join(taskDir, "environment", "judge", "judge-codex.js")
	if _, err := os.Stat(codexJudgePath); err != nil {
		t.Errorf("missing judge-codex.js: %v", err)
	}

	toml, _ := os.ReadFile(filepath.Join(taskDir, "task.toml"))
	if !strings.Contains(string(toml), "OPENAI_API_KEY") {
		t.Error("task.toml should contain OPENAI_API_KEY for codex judge")
	}
	if strings.Contains(string(toml), "ANTHROPIC_API_KEY") {
		t.Error("task.toml should not contain ANTHROPIC_API_KEY for codex judge")
	}

	testSh, _ := os.ReadFile(filepath.Join(taskDir, "tests", "test.sh"))
	if !strings.Contains(string(testSh), "judge-codex.js") {
		t.Error("test.sh should reference judge-codex.js for codex judge")
	}

	dockerfile, _ := os.ReadFile(filepath.Join(taskDir, "environment", "Dockerfile"))
	if !strings.Contains(string(dockerfile), "FROM docker/sandbox-templates:codex") {
		t.Error("codex agent should scaffold the codex sandbox image")
	}
}

func TestScaffoldTaskCodexContextFile(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task-codex-ctx")

	taskMD := []byte("# Test Task")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	packMD := "## Context Pack\n\nSome context."
	tmplData := templateData{JudgeSDK: "claude", JudgeModelDefault: "claude-sonnet-4-6"}

	if err := scaffoldTask(taskDir, taskMD, criteria, packMD, true, tmplData, "codex"); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	agentsMDPath := filepath.Join(taskDir, "environment", "AGENTS.md")
	if _, err := os.Stat(agentsMDPath); err != nil {
		t.Errorf("missing AGENTS.md: %v", err)
	}
	claudeMDPath := filepath.Join(taskDir, "environment", ".claude", "CLAUDE.md")
	if _, err := os.Stat(claudeMDPath); err == nil {
		t.Error("CLAUDE.md should not exist for codex agent")
	}

	got, _ := os.ReadFile(agentsMDPath)
	if !strings.Contains(string(got), packMD) {
		t.Error("AGENTS.md should contain pack content")
	}
}

func TestScaffoldTaskClaudeContextFile(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task-claude-ctx")

	taskMD := []byte("# Test Task")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	packMD := "## Context Pack"
	tmplData := templateData{JudgeSDK: "claude", JudgeModelDefault: "claude-sonnet-4-6"}

	if err := scaffoldTask(taskDir, taskMD, criteria, packMD, true, tmplData, "claude"); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	claudeMDPath := filepath.Join(taskDir, "environment", ".claude", "CLAUDE.md")
	if _, err := os.Stat(claudeMDPath); err != nil {
		t.Errorf("missing CLAUDE.md: %v", err)
	}
	agentsMDPath := filepath.Join(taskDir, "environment", "AGENTS.md")
	if _, err := os.Stat(agentsMDPath); err == nil {
		t.Error("AGENTS.md should not exist for claude agent")
	}
}

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

func TestExtractResults(t *testing.T) {
	dir := t.TempDir()

	// Create mock trial dirs matching Harbor's naming convention
	trial1 := filepath.Join(dir, "codegen-chain__abc123")
	trial2 := filepath.Join(dir, "codegen-chain-with-con__def456")

	for _, td := range []string{trial1, trial2} {
		os.MkdirAll(filepath.Join(td, "verifier"), 0o755)
	}

	// Write reward.json files
	reward1, _ := json.Marshal(map[string]float64{"reward": 0.2})
	reward2, _ := json.Marshal(map[string]float64{"reward": 1.0})
	os.WriteFile(filepath.Join(trial1, "verifier", "reward.json"), reward1, 0o644)
	os.WriteFile(filepath.Join(trial2, "verifier", "reward.json"), reward2, 0o644)

	// Write scores.json for trial 2
	scores, _ := json.Marshal(map[string]float64{
		"openapi_spec": 1.0,
		"ts_client":    1.0,
	})
	os.WriteFile(filepath.Join(trial2, "verifier", "scores.json"), scores, 0o644)

	// Also write result.json (not a trial dir)
	os.WriteFile(filepath.Join(dir, "result.json"), []byte("{}"), 0o644)

	results, err := extractResults(dir)
	if err != nil {
		t.Fatalf("extractResults: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	r := results[0]
	if r.taskName != "codegen-chain" {
		t.Errorf("taskName: got %q, want %q", r.taskName, "codegen-chain")
	}
	if r.withoutContext == nil {
		t.Fatal("withoutContext should not be nil")
	}
	if r.withoutContext.reward != 0.2 {
		t.Errorf("withoutContext reward: got %f, want 0.2", r.withoutContext.reward)
	}
	if r.withContext == nil {
		t.Fatal("withContext should not be nil")
	}
	if r.withContext.reward != 1.0 {
		t.Errorf("withContext reward: got %f, want 1.0", r.withContext.reward)
	}
	if len(r.withContext.details) != 2 {
		t.Errorf("withContext details: got %d entries, want 2", len(r.withContext.details))
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
