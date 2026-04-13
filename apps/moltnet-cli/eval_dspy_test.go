package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/checklist"
)

func TestValidateDSPYEvalOpts(t *testing.T) {
	ok := []evalRunOpts{
		{agent: "claude", judge: "claude", concurrency: 1},
		{agent: "claude", judge: "claude", concurrency: 2},
		{agent: "claude", judge: "claude", concurrency: 4},
		{agent: "codex", judge: "claude", concurrency: 1},
		{agent: "claude", judge: "codex", concurrency: 1},
		{agent: "codex", judge: "codex", concurrency: 1},
	}
	for _, opts := range ok {
		if err := validateDSPYEvalOpts(opts); err != nil {
			t.Errorf("validateDSPYEvalOpts(%+v) = %v, want nil", opts, err)
		}
	}

	bad := []evalRunOpts{
		{agent: "harbor", judge: "claude", concurrency: 1},
		{agent: "claude", judge: "harbor", concurrency: 1},
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

	got, err := buildWorkspaceSnapshot(dir, "final output", "vitro")
	if err != nil {
		t.Fatalf("buildWorkspaceSnapshot: %v", err)
	}
	if !strings.Contains(got, "final-response.txt") {
		t.Fatalf("expected fallback response file, got %q", got)
	}
}

func TestBuildVivoWorkspaceSnapshot(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	dir := t.TempDir()
	runGit := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
		}
	}

	runGit("init")
	runGit("config", "user.email", "test@example.com")
	runGit("config", "user.name", "Test User")

	// Seed files and create initial commit.
	if err := os.WriteFile(filepath.Join(dir, "notes.md"), []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "big.go"), []byte("package main\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("SECRET=hunter2"), 0644); err != nil {
		t.Fatal(err)
	}
	runGit("add", "notes.md", "big.go", ".env")
	runGit("commit", "-m", "init")

	// Modify: notes.md (small), big.go (over cap), .env (denied).
	changedNotes := "# Notes\nAgent ran codegen.\n"
	if err := os.WriteFile(filepath.Join(dir, "notes.md"), []byte(changedNotes), 0644); err != nil {
		t.Fatal(err)
	}
	bigContent := strings.Repeat("x", int(vivoSnapshotDiffCap)+1)
	if err := os.WriteFile(filepath.Join(dir, "big.go"), []byte(bigContent), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("SECRET=changed"), 0644); err != nil {
		t.Fatal(err)
	}

	got, err := buildWorkspaceSnapshot(dir, "", "vivo")
	if err != nil {
		t.Fatalf("buildWorkspaceSnapshot vivo: %v", err)
	}

	if !strings.Contains(got, "## git status") {
		t.Error("vivo snapshot missing git status section")
	}
	if !strings.Contains(got, "## git diff --stat") {
		t.Error("vivo snapshot missing git diff --stat section")
	}
	// Small changed file should be inlined.
	if !strings.Contains(got, changedNotes) {
		t.Error("vivo snapshot should include small changed file (notes.md)")
	}
	// Large file should NOT be inlined.
	if strings.Contains(got, bigContent[:100]) {
		t.Error("vivo snapshot should not include large file contents")
	}
	// .env should NOT be inlined (deny list).
	if strings.Contains(got, "SECRET=") {
		t.Error("vivo snapshot should not include .env contents")
	}
}

func TestBuildVivoWorkspaceSnapshotNoGit(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	// Not a git repo — git commands fail. Snapshot should still succeed
	// with "(unavailable)" markers and the fallback output.
	got, err := buildWorkspaceSnapshot(dir, "fallback text", "vivo")
	if err != nil {
		t.Fatalf("buildWorkspaceSnapshot vivo (no git): %v", err)
	}
	if !strings.Contains(got, "(unavailable)") {
		t.Error("expected (unavailable) marker when git is not available")
	}
	if !strings.Contains(got, "fallback text") {
		t.Error("expected fallback output when no evidence is available")
	}
}

func TestBuildWorkspaceSnapshotRejectsUnknownMode(t *testing.T) {
	_, err := buildWorkspaceSnapshot(t.TempDir(), "", "bogus")
	if err == nil {
		t.Fatal("expected error for unknown mode")
	}
	if !strings.Contains(err.Error(), "unknown eval mode") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildWorkspaceSnapshotVitroReadsFullContents(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	// Init a git repo so git status works.
	if err := exec.Command("git", "-C", dir, "init").Run(); err != nil {
		t.Skipf("git init failed: %v", err)
	}
	if err := exec.Command("git", "-C", dir, "config", "user.email", "test@test.com").Run(); err != nil {
		t.Skipf("git config failed: %v", err)
	}
	if err := exec.Command("git", "-C", dir, "config", "user.name", "Test").Run(); err != nil {
		t.Skipf("git config failed: %v", err)
	}
	// Initial commit so HEAD exists.
	if err := exec.Command("git", "-C", dir, "commit", "--allow-empty", "-m", "init").Run(); err != nil {
		t.Skipf("git commit failed: %v", err)
	}

	testFile := filepath.Join(dir, "result.md")
	content := "# Result\nThe answer is 42."
	if err := os.WriteFile(testFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	got, err := buildWorkspaceSnapshot(dir, "", "vitro")
	if err != nil {
		t.Fatalf("buildWorkspaceSnapshot vitro: %v", err)
	}

	// Vitro should read the full file content.
	if !strings.Contains(got, content) {
		t.Errorf("vitro snapshot should contain full file content, got:\n%s", got)
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

func TestDspyEvalSignature(t *testing.T) {
	tests := []struct {
		name       string
		mode       string
		wantInputs []string
		wantErr    bool
	}{
		{"vitro uses VitroSignature", "vitro", []string{"task_markdown", "context_pack"}, false},
		{"vivo uses VivoSignature", "vivo", []string{"task_markdown", "context_pack", "repo_ref"}, false},
		{"empty mode defaults to vitro", "", []string{"task_markdown", "context_pack"}, false},
		{"unknown mode errors", "bogus", nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sig, err := dspyEvalSignature(tt.mode)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error for unknown mode")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			gotNames := make([]string, len(sig.Inputs))
			for i, inp := range sig.Inputs {
				gotNames[i] = inp.Field.Name
			}
			if len(gotNames) != len(tt.wantInputs) {
				t.Fatalf("got %d inputs %v, want %d %v", len(gotNames), gotNames, len(tt.wantInputs), tt.wantInputs)
			}
			for i, want := range tt.wantInputs {
				if gotNames[i] != want {
					t.Errorf("input[%d] = %q, want %q", i, gotNames[i], want)
				}
			}
		})
	}
}

func TestBuildSolverInputs(t *testing.T) {
	tests := []struct {
		name       string
		mode       string
		fixtureRef string
		packMD     string
		withCtx    bool
		wantKeys   []string
		wantRef    string
		wantPack   string
		wantErr    bool
	}{
		{
			name:     "vitro omits repo_ref",
			mode:     "vitro",
			packMD:   "pack",
			withCtx:  true,
			wantKeys: []string{"task_markdown", "context_pack"},
			wantPack: "pack",
		},
		{
			name:       "vivo includes repo_ref",
			mode:       "vivo",
			fixtureRef: "abc123",
			packMD:     "pack",
			withCtx:    true,
			wantKeys:   []string{"task_markdown", "context_pack", "repo_ref"},
			wantRef:    "abc123",
			wantPack:   "pack",
		},
		{
			name:    "vivo without fixtureRef errors",
			mode:    "vivo",
			packMD:  "pack",
			withCtx: true,
			wantErr: true,
		},
		{
			name:     "baseline omits pack content",
			mode:     "vitro",
			packMD:   "pack",
			withCtx:  false,
			wantKeys: []string{"task_markdown", "context_pack"},
			wantPack: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inputs, err := buildSolverInputs(solverInput{
				taskMD:      "# task",
				packMD:      tt.packMD,
				withContext: tt.withCtx,
				mode:        tt.mode,
				fixtureRef:  tt.fixtureRef,
			})
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			for _, key := range tt.wantKeys {
				if _, ok := inputs[key]; !ok {
					t.Errorf("missing key %q in inputs %v", key, inputs)
				}
			}
			if len(inputs) != len(tt.wantKeys) {
				t.Errorf("got %d keys, want %d: %v", len(inputs), len(tt.wantKeys), inputs)
			}
			if tt.wantRef != "" {
				if got, _ := inputs["repo_ref"].(string); got != tt.wantRef {
					t.Errorf("repo_ref = %q, want %q", got, tt.wantRef)
				}
			}
			if got, _ := inputs["context_pack"].(string); got != tt.wantPack {
				t.Errorf("context_pack = %q, want %q", got, tt.wantPack)
			}
		})
	}
}
