package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScaffoldTask(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task")

	taskMD := []byte("# Test Task\nDo something.")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)

	if err := scaffoldTask(taskDir, taskMD, criteria, "", false); err != nil {
		t.Fatalf("scaffoldTask: %v", err)
	}

	// Verify directory structure
	for _, path := range []string{
		"task.toml",
		"instruction.md",
		"environment/Dockerfile",
		"environment/judge/judge.js",
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
}

func TestScaffoldTaskWithContext(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "test-task-ctx")

	taskMD := []byte("# Test Task")
	criteria := []byte(`{"type":"weighted_checklist","checklist":[]}`)
	packMD := "## My Pack\n\nSome context here."

	if err := scaffoldTask(taskDir, taskMD, criteria, packMD, true); err != nil {
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
	config := "runs:\n  - task: task1\n    pack: pack.md\n  - task: task2\n"
	os.WriteFile(configPath, []byte(config), 0o644)

	runs, err := loadConfig(configPath)
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if !filepath.IsAbs(runs[0].Task) {
		t.Error("task path should be absolute")
	}
	if runs[0].Pack == "" {
		t.Error("run 0 should have a pack")
	}
	if runs[1].Pack != "" {
		t.Errorf("run 1 should have no pack, got %q", runs[1].Pack)
	}
}

func TestLoadConfigInvalid(t *testing.T) {
	dir := t.TempDir()

	// Config pointing to missing task dir
	configPath := filepath.Join(dir, "eval.yaml")
	os.WriteFile(configPath, []byte("runs:\n  - task: nonexistent\n"), 0o644)

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
	trial2 := filepath.Join(dir, "codegen-chain-with-conte__def456")

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
