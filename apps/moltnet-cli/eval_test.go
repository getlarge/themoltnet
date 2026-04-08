package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/checklist"
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

func TestScaffoldTaskIncludesRetryJS(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task-retry-js")

	taskMD := []byte("# Test Task")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	tmplData := templateData{JudgeSDK: "claude", JudgeModelDefault: "claude-sonnet-4-6"}

	if err := scaffoldTask(taskDir, taskMD, criteria, "", false, tmplData, "claude"); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	retryJSPath := filepath.Join(taskDir, "environment", "judge", "retry.js")
	if _, err := os.Stat(retryJSPath); err != nil {
		t.Errorf("missing environment/judge/retry.js: %v", err)
	}
}

func TestScaffoldTaskIncludesJudgeMaxRetries(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task-retries")

	taskMD := []byte("# Test Task")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	tmplData := templateData{JudgeSDK: "claude", JudgeModelDefault: "claude-sonnet-4-6"}

	if err := scaffoldTask(taskDir, taskMD, criteria, "", false, tmplData, "claude"); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	toml, err := os.ReadFile(filepath.Join(taskDir, "task.toml"))
	if err != nil {
		t.Fatalf("reading task.toml: %v", err)
	}
	if !strings.Contains(string(toml), "JUDGE_MAX_RETRIES") {
		t.Error("task.toml should contain JUDGE_MAX_RETRIES")
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

func TestExtractResultsIncludesConcreteErrorDetail(t *testing.T) {
	dir := t.TempDir()
	trial := filepath.Join(dir, "codegen-chain__abc123")

	if err := os.MkdirAll(filepath.Join(trial, "verifier"), 0o755); err != nil {
		t.Fatalf("mkdir verifier: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(trial, "agent"), 0o755); err != nil {
		t.Fatalf("mkdir agent: %v", err)
	}

	resultJSON := `{
		"exception_info": {
			"exception_type": "NonZeroAgentExitCodeError",
			"exception_message": "wrapper error"
		}
	}`
	if err := os.WriteFile(filepath.Join(trial, "result.json"), []byte(resultJSON), 0o644); err != nil {
		t.Fatalf("write result.json: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(trial, "exception.txt"),
		[]byte("stdout: Permission denied (os error 13)\n"),
		0o644,
	); err != nil {
		t.Fatalf("write exception.txt: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(trial, "verifier", "reward.json"),
		[]byte(`{"reward":0}`),
		0o644,
	); err != nil {
		t.Fatalf("write reward.json: %v", err)
	}

	results, err := extractResults(dir)
	if err != nil {
		t.Fatalf("extractResults: %v", err)
	}
	if len(results) != 1 || results[0].withoutContext == nil {
		t.Fatalf("unexpected results shape: %+v", results)
	}

	got := results[0].withoutContext.err
	if !strings.Contains(got, "NonZeroAgentExitCodeError") {
		t.Fatalf("expected wrapper error type, got %q", got)
	}
	if !strings.Contains(got, "Permission denied (os error 13)") {
		t.Fatalf("expected concrete error detail, got %q", got)
	}
}

func TestExtractResultsIgnoresAgentLogNoiseWithoutException(t *testing.T) {
	dir := t.TempDir()
	trial := filepath.Join(dir, "codegen-chain__abc123")

	if err := os.MkdirAll(filepath.Join(trial, "verifier"), 0o755); err != nil {
		t.Fatalf("mkdir verifier: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(trial, "agent"), 0o755); err != nil {
		t.Fatalf("mkdir agent: %v", err)
	}

	if err := os.WriteFile(filepath.Join(trial, "result.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write result.json: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(trial, "agent", "codex.txt"),
		[]byte(`{"type":"item.completed","item":{"command":"ls /root","aggregated_output":"Permission denied","status":"failed"}}`+"\n"),
		0o644,
	); err != nil {
		t.Fatalf("write agent log: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(trial, "verifier", "reward.json"),
		[]byte(`{"reward":0}`),
		0o644,
	); err != nil {
		t.Fatalf("write reward.json: %v", err)
	}

	results, err := extractResults(dir)
	if err != nil {
		t.Fatalf("extractResults: %v", err)
	}
	if len(results) != 1 || results[0].withoutContext == nil {
		t.Fatalf("unexpected results shape: %+v", results)
	}
	if got := results[0].withoutContext.err; got != "" {
		t.Fatalf("expected no error from agent log noise, got %q", got)
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
		{"harbor", true},
		{"dspy", true},
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

func TestValidateDSPYEvalOpts(t *testing.T) {
	ok := []evalRunOpts{
		{engine: "dspy", agent: "claude", judge: "claude", concurrency: 1},
		{engine: "dspy", agent: "claude", judge: "claude", concurrency: 2},
		{engine: "dspy", agent: "claude", judge: "claude", concurrency: 4},
		{engine: "dspy", agent: "codex", judge: "claude", concurrency: 1},
		{engine: "dspy", agent: "claude", judge: "codex", concurrency: 1},
		{engine: "dspy", agent: "codex", judge: "codex", concurrency: 1},
	}
	for _, opts := range ok {
		if err := validateDSPYEvalOpts(opts); err != nil {
			t.Errorf("validateDSPYEvalOpts(%+v) = %v, want nil", opts, err)
		}
	}

	bad := []evalRunOpts{
		{engine: "dspy", agent: "harbor", judge: "claude", concurrency: 1},
		{engine: "dspy", agent: "claude", judge: "harbor", concurrency: 1},
	}
	for _, opts := range bad {
		if err := validateDSPYEvalOpts(opts); err == nil {
			t.Errorf("validateDSPYEvalOpts(%+v) = nil, want error", opts)
		}
	}
}

func TestWriteDSPYEvalPackToDisk(t *testing.T) {
	dir := t.TempDir()
	packMD := "## Section\n\nsome content"
	if err := writeDSPYEvalPackToDisk(dir, packMD); err != nil {
		t.Fatalf("writeDSPYEvalPackToDisk: %v", err)
	}

	packContent, err := os.ReadFile(filepath.Join(dir, "context-pack.md"))
	if err != nil {
		t.Fatalf("read context-pack.md: %v", err)
	}
	if !strings.Contains(string(packContent), packMD) {
		t.Error("context-pack.md missing pack content")
	}

	claudeMD, err := os.ReadFile(filepath.Join(dir, ".claude", "CLAUDE.md"))
	if err != nil {
		t.Fatalf("read .claude/CLAUDE.md: %v", err)
	}
	if !strings.Contains(string(claudeMD), "@../context-pack.md") {
		t.Error(".claude/CLAUDE.md must @-import ../context-pack.md")
	}
	if strings.Contains(string(claudeMD), packMD) {
		t.Error(".claude/CLAUDE.md must not inline pack content")
	}

	agentsMD, err := os.ReadFile(filepath.Join(dir, "AGENTS.md"))
	if err != nil {
		t.Fatalf("read AGENTS.md: %v", err)
	}
	if !strings.Contains(string(agentsMD), packMD) {
		t.Error("AGENTS.md must inline pack content (Codex does not support @-imports)")
	}
	if strings.Contains(string(agentsMD), "@context-pack.md") {
		t.Error("AGENTS.md must not use @-import")
	}
}

func TestBuildWorkspaceSnapshotFallsBackToFinalResponse(t *testing.T) {
	dir := t.TempDir()

	got, err := buildWorkspaceSnapshot(dir, "final output")
	if err != nil {
		t.Fatalf("buildWorkspaceSnapshot: %v", err)
	}
	if !strings.Contains(got, "final-response.txt") {
		t.Fatalf("expected fallback response file, got %q", got)
	}
}

func TestParseChecklistCriteriaRejectsUnsupportedType(t *testing.T) {
	_, err := parseChecklistCriteria([]byte(`{"type":"binary"}`))
	if err == nil {
		t.Fatal("expected unsupported criteria type error")
	}
}

func TestParseGitStatusPathsIgnoresNeutralizedFiles(t *testing.T) {
	got := parseGitStatusPaths(" M apps/moltnet-cli/eval.go\n D AGENTS.md\n D .claude/CLAUDE.md\n?? new-file.md\n")
	if len(got) != 2 {
		t.Fatalf("expected 2 paths, got %v", got)
	}
	if got[0] != "apps/moltnet-cli/eval.go" || got[1] != "new-file.md" {
		t.Fatalf("unexpected paths: %v", got)
	}
}

func TestParseGitStatusPathsSkipsDeletedEntries(t *testing.T) {
	got := parseGitStatusPaths(" D .agents/skills/legreffier/SKILL.md\n M docs/guide.md\n")
	if len(got) != 1 || got[0] != "docs/guide.md" {
		t.Fatalf("unexpected paths: %v", got)
	}
}

func TestNeutralizeDSPYEvalWorktreeUsesGlobExcludes(t *testing.T) {
	dir := t.TempDir()

	if err := os.MkdirAll(filepath.Join(dir, ".agents", "skills"), 0o755); err != nil {
		t.Fatalf("mkdir .agents: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".agents", "skills", "guide.md"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write .agents file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "guide.md"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write docs guide: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "keep.go"), []byte("package main"), 0o644); err != nil {
		t.Fatalf("write go file: %v", err)
	}

	filter := newDSPYWorktreeFilter(evalRunOpts{
		worktreeExcludes: []string{"docs/*.md"},
	}, nil)
	if !filter.matches(".agents/skills/guide.md", false) {
		t.Fatal("expected default .agents exclusion to match")
	}
	if !filter.matches("docs/guide.md", false) {
		t.Fatal("expected custom docs glob to match")
	}
	if err := neutralizeDSPYEvalWorktree(dir, filter); err != nil {
		t.Fatalf("neutralizeDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, ".agents")); !os.IsNotExist(err) {
		t.Fatalf("expected .agents removed, got err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "guide.md")); !os.IsNotExist(err) {
		t.Fatalf("expected docs markdown removed, got err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "keep.go")); err != nil {
		t.Fatalf("expected keep.go preserved: %v", err)
	}
}

func TestDSPYWorktreeFilterMatchesDefaultsAndCustomGlobs(t *testing.T) {
	filter := newDSPYWorktreeFilter(evalRunOpts{
		worktreeExcludes: []string{
			"docs/*.md",
			"vendor/**",
			"agents/*.md",
		},
	}, nil)

	tests := []struct {
		rel   string
		isDir bool
		want  bool
	}{
		{rel: "AGENTS.md", want: true},
		{rel: ".claude/settings.json", want: true},
		{rel: ".agents/skills/guide.md", want: true},
		{rel: ".codex/config.toml", want: true},
		{rel: "tiles/skill-a/evals/scenario-1/task.md", want: true},
		{rel: "tiles/skill-a/evals/scenario-1/config.json", want: false},
		{rel: "docs/guide.md", want: true},
		{rel: "docs/nested/guide.md", want: false},
		{rel: "vendor/pkg/file.go", want: true},
		{rel: "agents/readme.md", want: true},
		{rel: "agents/readme.txt", want: false},
		{rel: "src/main.go", want: false},
	}

	for _, tt := range tests {
		if got := filter.matches(tt.rel, tt.isDir); got != tt.want {
			t.Errorf("filter.matches(%q, %v) = %v, want %v", tt.rel, tt.isDir, got, tt.want)
		}
	}
}

func TestCreateDSPYEvalWorktreeRequiresFrozenSourceRef(t *testing.T) {
	_, _, err := createDSPYEvalWorktree(t.TempDir(), "test", evalRunOpts{}, nil)
	if err == nil || !strings.Contains(err.Error(), "missing frozen dspy source ref") {
		t.Fatalf("unexpected error: %v", err)
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

func TestWriteDSPYAgentArtifactsWritesTrajectory(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	agent := &dspyAgentRunResult{
		passed: true,
		output: "agent said hello",
		trajectory: []json.RawMessage{
			json.RawMessage(`{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}`),
			json.RawMessage(`{"type":"result","result":"hello"}`),
		},
	}
	if err := writeDSPYAgentArtifacts(dir, agent); err != nil {
		t.Fatalf("writeDSPYAgentArtifacts: %v", err)
	}

	// Check agent-output.txt
	out, err := os.ReadFile(filepath.Join(dir, "agent-output.txt"))
	if err != nil {
		t.Fatalf("read agent-output.txt: %v", err)
	}
	if string(out) != "agent said hello" {
		t.Fatalf("unexpected agent output: %q", string(out))
	}

	// Check trajectory.json (normalized Phase 0 contract)
	trajData, err := os.ReadFile(filepath.Join(dir, "trajectory.json"))
	if err != nil {
		t.Fatalf("read trajectory.json: %v", err)
	}
	var traj normalizedTrajectory
	if err := json.Unmarshal(trajData, &traj); err != nil {
		t.Fatalf("parse trajectory.json: %v", err)
	}
	if traj.SchemaVersion != artifactSchemaVersion {
		t.Fatalf("expected schema_version %q, got %q", artifactSchemaVersion, traj.SchemaVersion)
	}
	if traj.Engine != "dspy" {
		t.Fatalf("expected engine 'dspy', got %q", traj.Engine)
	}
	if traj.FinalResult != "agent said hello" {
		t.Fatalf("expected final result, got %q", traj.FinalResult)
	}
}

func TestWriteDSPYAgentArtifactsNoTrajectory(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	agent := &dspyAgentRunResult{
		passed: true,
		output: "hello",
	}
	if err := writeDSPYAgentArtifacts(dir, agent); err != nil {
		t.Fatalf("writeDSPYAgentArtifacts: %v", err)
	}
	// trajectory.json should not exist when trajectory is empty
	if _, err := os.Stat(filepath.Join(dir, "trajectory.json")); !os.IsNotExist(err) {
		t.Fatal("expected no trajectory.json when trajectory is empty")
	}
}

func TestWriteDSPYVariantArtifactsStructure(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	agent := &dspyAgentRunResult{
		passed:     true,
		output:     "done",
		durationMs: 2000,
		costUSD:    0.08,
		numTurns:   2,
	}
	judged := &checklist.Result{
		Reward:  0.75,
		Details: map[string]float64{"criterion_a": 0.5, "criterion_b": 1.0},
		Scores: []checklist.ScoredCriterion{
			{Name: "A", Score: 5, MaxScore: 10, Evidence: "partial"},
			{Name: "B", Score: 10, MaxScore: 10, Evidence: "full"},
		},
		Reasoning: "good work",
	}
	opts := evalRunOpts{agent: "claude", judge: "claude", model: "anthropic/claude-sonnet-4-6", judgeModel: "claude-sonnet-4-6"}
	if err := writeDSPYVariantArtifacts(dir, agent, judged, 500, "test-scenario", "without-context", "claude", "anthropic/claude-sonnet-4-6", opts); err != nil {
		t.Fatalf("writeDSPYVariantArtifacts: %v", err)
	}

	// Check trial_result.json (Phase 0 contract)
	trData, err := os.ReadFile(filepath.Join(dir, "trial_result.json"))
	if err != nil {
		t.Fatalf("read trial_result.json: %v", err)
	}
	var trial map[string]any
	if err := json.Unmarshal(trData, &trial); err != nil {
		t.Fatalf("parse trial_result.json: %v", err)
	}
	if trial["schema_version"] != artifactSchemaVersion {
		t.Fatalf("expected schema_version %q, got %v", artifactSchemaVersion, trial["schema_version"])
	}
	if trial["engine"] != "dspy" {
		t.Fatalf("expected engine 'dspy', got %v", trial["engine"])
	}
	if trial["status"] != "success" {
		t.Fatalf("expected status 'success', got %v", trial["status"])
	}
	scores, _ := trial["scores"].(map[string]any)
	if scores["normalized_reward"] != 0.75 {
		t.Fatalf("expected reward 0.75, got %v", scores["normalized_reward"])
	}
	timings, _ := trial["timings_ms"].(map[string]any)
	if timings["agent"] != float64(2000) {
		t.Fatalf("expected agent timing 2000, got %v", timings["agent"])
	}
	if timings["judge"] != float64(500) {
		t.Fatalf("expected judge timing 500, got %v", timings["judge"])
	}

	// Check trace.jsonl exists
	if _, err := os.Stat(filepath.Join(dir, "trace.jsonl")); err != nil {
		t.Fatal("missing trace.jsonl")
	}

	// Check backward-compat files
	if _, err := os.Stat(filepath.Join(dir, "verifier", "reward.json")); err != nil {
		t.Fatal("missing verifier/reward.json")
	}
	if _, err := os.Stat(filepath.Join(dir, "verifier", "scores.json")); err != nil {
		t.Fatal("missing verifier/scores.json")
	}
	if _, err := os.Stat(filepath.Join(dir, "verifier", "reasoning.txt")); err != nil {
		t.Fatal("missing verifier/reasoning.txt")
	}
}

func TestWriteDSPYRunSummaryJobResult(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	result := evalResult{
		taskName: "test-task",
		withoutContext: &trialScores{
			name:   "test-task__dspy",
			reward: 0.4,
		},
		withContext: &trialScores{
			name:   "test-task-with-context__dspy",
			reward: 0.9,
		},
	}
	opts := evalRunOpts{agent: "claude", judge: "claude", model: "anthropic/claude-sonnet-4-6", judgeModel: "claude-sonnet-4-6"}
	if err := writeJobResultSummary(dir, "dspy", time.Now().Add(-time.Minute), []evalResult{result}, opts); err != nil {
		t.Fatalf("writeJobResultSummary: %v", err)
	}

	// Check job_result.json (Phase 0 contract)
	data, err := os.ReadFile(filepath.Join(dir, "job_result.json"))
	if err != nil {
		t.Fatalf("read job_result.json: %v", err)
	}
	var job map[string]any
	if err := json.Unmarshal(data, &job); err != nil {
		t.Fatalf("parse job_result.json: %v", err)
	}
	if job["schema_version"] != artifactSchemaVersion {
		t.Fatalf("expected schema_version %q, got %v", artifactSchemaVersion, job["schema_version"])
	}
	if job["engine"] != "dspy" {
		t.Fatalf("expected engine 'dspy', got %v", job["engine"])
	}
	summary, _ := job["summary"].(map[string]any)
	if summary["completion_rate"] != 1.0 {
		t.Fatalf("expected completion_rate 1.0, got %v", summary["completion_rate"])
	}
	if summary["average_delta"] == nil {
		t.Fatal("expected average_delta")
	}
	avgDelta, _ := summary["average_delta"].(float64)
	if avgDelta < 0.49 || avgDelta > 0.51 {
		t.Fatalf("expected average_delta ~0.5, got %f", avgDelta)
	}

	// Check backward-compat result.json also exists
	if _, err := os.Stat(filepath.Join(dir, "result.json")); err != nil {
		t.Fatal("missing backward-compat result.json")
	}
}

func TestWriteDSPYRunSummaryNoDeltaOnError(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	result := evalResult{
		taskName: "fail-task",
		withoutContext: &trialScores{
			name:   "fail-task__dspy",
			reward: 0.5,
		},
		withContext: &trialScores{
			name: "fail-task-with-context__dspy",
			err:  "judge failed",
		},
	}
	opts := evalRunOpts{agent: "claude", judge: "claude", model: "anthropic/claude-sonnet-4-6", judgeModel: "claude-sonnet-4-6"}
	if err := writeJobResultSummary(dir, "dspy", time.Now(), []evalResult{result}, opts); err != nil {
		t.Fatalf("writeJobResultSummary: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "job_result.json"))
	if err != nil {
		t.Fatalf("read job_result.json: %v", err)
	}
	var job map[string]any
	if err := json.Unmarshal(data, &job); err != nil {
		t.Fatalf("parse job_result.json: %v", err)
	}
	// With errors, results[0].delta should be null
	results, _ := job["results"].([]any)
	if len(results) == 0 {
		t.Fatal("expected results array")
	}
	entry, _ := results[0].(map[string]any)
	if entry["delta"] != nil {
		t.Fatal("expected null delta when a trial has errors")
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

func TestTrimOpenAIModelPrefix(t *testing.T) {
	if got := trimOpenAIModelPrefix("openai/gpt-5-codex"); got != "gpt-5-codex" {
		t.Fatalf("expected 'gpt-5-codex', got %q", got)
	}
	if got := trimOpenAIModelPrefix("gpt-5-codex"); got != "gpt-5-codex" {
		t.Fatalf("expected no-op for unprefixed, got %q", got)
	}
}

func TestDspyJudgeProvider(t *testing.T) {
	tests := []struct {
		judge      string
		judgeModel string
		wantProv   string
		wantModel  string
	}{
		{"claude", "claude-sonnet-4-6", "claude-code", "claude-sonnet-4-6"},
		{"claude", "anthropic/claude-sonnet-4-6", "claude-code", "claude-sonnet-4-6"},
		{"codex", "gpt-5-codex", "codex", "gpt-5-codex"},
	}
	for _, tt := range tests {
		prov, model := dspyJudgeProvider(tt.judge, tt.judgeModel)
		if prov != tt.wantProv || model != tt.wantModel {
			t.Errorf("dspyJudgeProvider(%q, %q) = (%q, %q), want (%q, %q)",
				tt.judge, tt.judgeModel, prov, model, tt.wantProv, tt.wantModel)
		}
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

func TestSparsePassDSPYEvalWorktree_KeepsTaskMD(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"app"}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "index.ts"), []byte("export {}"), 0o644); err != nil {
		t.Fatalf("write src/index.ts: %v", err)
	}

	include := []string{"task.md"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "task.md")); err != nil {
		t.Error("task.md should be kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
		t.Error("package.json should be removed")
	}
	if _, err := os.Stat(filepath.Join(dir, "src")); err == nil {
		t.Error("src/ should be removed")
	}
}

func TestSparsePassDSPYEvalWorktree_KeepsMultipleIncludes(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fixture.ts"), []byte("export const x = 1"), 0o644); err != nil {
		t.Fatalf("write fixture.ts: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "unrelated.go"), []byte("package main"), 0o644); err != nil {
		t.Fatalf("write unrelated.go: %v", err)
	}

	include := []string{"task.md", "fixture.ts"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "task.md")); err != nil {
		t.Error("task.md should be kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "fixture.ts")); err != nil {
		t.Error("fixture.ts should be kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "unrelated.go")); err == nil {
		t.Error("unrelated.go should be removed")
	}
}

func TestSparsePassDSPYEvalWorktree_KeepsGitDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".git", "config"), []byte("[core]"), 0o644); err != nil {
		t.Fatalf("write .git/config: %v", err)
	}

	include := []string{"task.md"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		t.Error(".git should be preserved")
	}
}

// TestSparsePassDSPYEvalWorktree_KeepsGitFile verifies that .git as a
// gitdir-pointer file (the shape `git worktree add` creates) is preserved.
// The previous implementation only skipped .git when d.IsDir(), which
// silently deleted the pointer file in real git worktree checkouts.
func TestSparsePassDSPYEvalWorktree_KeepsGitFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	gitPointer := []byte("gitdir: /tmp/repo/.git/worktrees/test\n")
	gitPath := filepath.Join(dir, ".git")
	if err := os.WriteFile(gitPath, gitPointer, 0o644); err != nil {
		t.Fatalf("write .git file: %v", err)
	}

	include := []string{"task.md"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	info, err := os.Stat(gitPath)
	if err != nil {
		t.Fatalf(".git should be preserved: %v", err)
	}
	if info.IsDir() {
		t.Fatal(".git should remain a file for worktree checkouts")
	}
	got, err := os.ReadFile(gitPath)
	if err != nil {
		t.Fatalf("read .git: %v", err)
	}
	if !bytes.Equal(got, gitPointer) {
		t.Fatalf(".git contents changed: got %q want %q", got, gitPointer)
	}
}

// TestSparsePassDSPYEvalWorktree_EmptyIncludeWipesAll verifies the vitro
// default: an empty include list produces a fully empty worktree except
// for .git. Vitro scenarios receive task instructions through the prompt,
// not the filesystem.
func TestSparsePassDSPYEvalWorktree_EmptyIncludeWipesAll(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".git"), []byte("gitdir: x\n"), 0o644); err != nil {
		t.Fatalf("write .git: %v", err)
	}

	if err := sparsePassDSPYEvalWorktree(dir, nil); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "task.md")); err == nil {
		t.Error("task.md should be removed on empty include")
	}
	if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
		t.Error("package.json should be removed on empty include")
	}
	if _, err := os.Stat(filepath.Join(dir, "src")); err == nil {
		t.Error("src/ should be removed on empty include")
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		t.Error(".git should be preserved even with empty include")
	}
}

// TestNeutralizeDSPYEvalWorktree_KeepsGitFile verifies .git-as-file
// preservation on the vivo path (neutralizeDSPYEvalWorktree).
func TestNeutralizeDSPYEvalWorktree_KeepsGitFile(t *testing.T) {
	dir := t.TempDir()
	gitPath := filepath.Join(dir, ".git")
	if err := os.WriteFile(gitPath, []byte("gitdir: /tmp/repo/.git/worktrees/test\n"), 0o644); err != nil {
		t.Fatalf("write .git: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write keep.txt: %v", err)
	}

	filter := newDefaultDSPYWorktreeFilter()
	if err := neutralizeDSPYEvalWorktree(dir, filter); err != nil {
		t.Fatalf("neutralizeDSPYEvalWorktree: %v", err)
	}
	if _, err := os.Stat(gitPath); err != nil {
		t.Error(".git file should be preserved by neutralize pass")
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
