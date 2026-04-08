package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	dspyadapters "github.com/getlarge/themoltnet/libs/dspy-adapters"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/checklist"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/claudecode"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/codex"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/solver"
	dspytypes "github.com/getlarge/themoltnet/libs/dspy-adapters/types"
	"gopkg.in/yaml.v2"
)

// evalRunOpts holds flags shared by single-task and config modes.
type evalRunOpts struct {
	engine           string
	model            string
	concurrency      int
	forceBuild       bool
	agent            string // "claude" | "codex"
	judge            string // "claude" | "codex"
	judgeModel       string // judge model (prefix-free)
	worktreeExcludes []string
	dspyRepoRoot     string
	dspySourceRef    string
	solverKind       solver.Kind // "cot" (default) or "react"
	dspyMode         string      // "vitro" | "vivo" | "" (legacy)
	dspyFixtureRef   string      // --fixture-ref CLI override
}

// worktreeMu serializes git worktree add/remove operations to avoid
// index.lock races when running variants concurrently.
var worktreeMu sync.Mutex

func validateEvalEngine(engine string) error {
	switch engine {
	case "harbor", "dspy":
		return nil
	default:
		return fmt.Errorf("unknown engine %q (must be harbor or dspy)", engine)
	}
}

type dspyWorktreeFilter struct {
	excludeGlobs []string
}

func newDefaultDSPYWorktreeFilter() dspyWorktreeFilter {
	return dspyWorktreeFilter{
		excludeGlobs: []string{
			"AGENTS.md",
			"CLAUDE.md",
			".claude",
			".claude/**",
			".agents",
			".agents/**",
			".codex",
			".codex/**",
			"tiles/**/*.md",
		},
	}
}

// newDSPYWorktreeFilter merges user-supplied --worktree-exclude globs with the
// default filter. Currently additive only: user globs extend the defaults.
//
// TODO: consider making this a replace/absolute mode so users can provide the
// complete exclude list when they want full control (e.g. to preserve their own
// CLAUDE.md or AGENTS.md from the repo). Right now the defaults always apply
// and user globs can only add more paths to remove.
func newDSPYWorktreeFilter(opts evalRunOpts, manifest *evalManifest) dspyWorktreeFilter {
	filter := newDefaultDSPYWorktreeFilter()
	for _, glob := range opts.worktreeExcludes {
		glob = strings.Trim(strings.TrimSpace(filepath.ToSlash(glob)), "/")
		if glob == "" {
			continue
		}
		filter.excludeGlobs = append(filter.excludeGlobs, glob)
	}
	if manifest != nil {
		for _, glob := range manifest.Fixture.Exclude {
			glob = strings.Trim(strings.TrimSpace(filepath.ToSlash(glob)), "/")
			if glob == "" {
				continue
			}
			filter.excludeGlobs = append(filter.excludeGlobs, glob)
		}
	}
	sort.Strings(filter.excludeGlobs)
	return filter
}

// dspyEvalMode returns the effective mode for a variant run.
// CLI --mode overrides eval.json; absent eval.json = legacy full-HEAD.
func dspyEvalMode(manifest *evalManifest, opts evalRunOpts) string {
	if opts.dspyMode != "" {
		return opts.dspyMode
	}
	if manifest != nil {
		return manifest.Mode
	}
	return ""
}

func defaultAgentModel(agent string) string {
	switch agent {
	case "codex":
		return "openai/gpt-5-codex"
	default:
		return "anthropic/claude-sonnet-4-6"
	}
}

func defaultJudgeModel(judge string) string {
	switch judge {
	case "codex":
		return "gpt-5-codex"
	default:
		return "claude-sonnet-4-6"
	}
}

func validateAgentModel(agent, model string) error {
	switch agent {
	case "claude":
		if !strings.HasPrefix(model, "anthropic/") {
			return fmt.Errorf("--agent claude requires model with anthropic/ prefix, got %q", model)
		}
	case "codex":
		if !strings.HasPrefix(model, "openai/") {
			return fmt.Errorf("--agent codex requires model with openai/ prefix, got %q", model)
		}
	default:
		return fmt.Errorf("unknown agent %q (must be claude or codex)", agent)
	}
	return nil
}

func validateJudgeModel(judge, model string) error {
	switch judge {
	case "claude":
		if !strings.HasPrefix(model, "claude-") {
			return fmt.Errorf("--judge claude requires judge-model starting with claude-, got %q", model)
		}
	case "codex":
		if !strings.HasPrefix(model, "gpt-") {
			return fmt.Errorf("--judge codex requires judge-model starting with gpt-, got %q", model)
		}
	default:
		return fmt.Errorf("unknown judge %q (must be claude or codex)", judge)
	}
	return nil
}

// evalRun describes one task + optional pack pair (used in config mode).
type evalRun struct {
	Scenario string `yaml:"scenario" json:"scenario"`
	Pack     string `yaml:"pack,omitempty" json:"pack,omitempty"`
	Agent    string `yaml:"agent,omitempty" json:"agent,omitempty"`
	Model    string `yaml:"model,omitempty" json:"model,omitempty"`
}

// evalRunInput is the resolved input for a single eval run.
type evalRunInput struct {
	name         string
	taskMD       []byte
	criteriaJSON []byte
	packMD       string
	agent        string
	model        string
	manifest     *evalManifest // nil if eval.json absent (Phase 1 fallback)
}

// evalConfig is the batch config file schema (YAML or JSON).
type evalConfig struct {
	Runs []evalRun `yaml:"runs" json:"runs"`
}

// --- Prerequisites ---

func checkPrerequisites(engine string, opts ...evalRunOpts) error {
	switch engine {
	case "dspy":
		if _, err := exec.LookPath("git"); err != nil {
			return fmt.Errorf("git CLI not found on PATH: %w", err)
		}
		agent := "claude"
		judge := "claude"
		if len(opts) > 0 {
			agent = opts[0].agent
			judge = opts[0].judge
		}
		switch agent {
		case "codex":
			if _, err := exec.LookPath("codex"); err != nil {
				return fmt.Errorf("codex CLI not found on PATH: %w", err)
			}
		default:
			if _, err := exec.LookPath("claude"); err != nil {
				return fmt.Errorf("claude CLI not found on PATH: %w", err)
			}
		}
		if judge == "codex" && agent != "codex" {
			if _, err := exec.LookPath("codex"); err != nil {
				return fmt.Errorf("codex CLI not found on PATH (required for --judge codex): %w", err)
			}
		}
		if judge == "claude" && agent != "claude" {
			if _, err := exec.LookPath("claude"); err != nil {
				return fmt.Errorf("claude CLI not found on PATH (required for --judge claude): %w", err)
			}
		}
		return nil
	case "harbor":
	default:
		return fmt.Errorf("unsupported engine %q", engine)
	}

	if _, err := exec.LookPath("harbor"); err != nil {
		return fmt.Errorf("harbor CLI not found on PATH — install with: uv tool install harbor")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		return fmt.Errorf("docker CLI not found on PATH: %w", err)
	}
	if err := exec.Command("docker", "info").Run(); err != nil {
		return fmt.Errorf("docker daemon not running or not accessible: %w", err)
	}
	return nil
}

// --- Config loading ---

func loadConfig(path string) ([]evalRun, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}
	var cfg evalConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	if len(cfg.Runs) == 0 {
		return nil, fmt.Errorf("config has no runs defined")
	}

	configDir := filepath.Dir(path)
	for i := range cfg.Runs {
		r := &cfg.Runs[i]
		if !filepath.IsAbs(r.Scenario) {
			r.Scenario = filepath.Join(configDir, r.Scenario)
		}
		if r.Pack != "" && !filepath.IsAbs(r.Pack) {
			r.Pack = filepath.Join(configDir, r.Pack)
		}
		if err := validateTaskDir(r.Scenario); err != nil {
			return nil, fmt.Errorf("run %d: %w", i+1, err)
		}
	}
	return cfg.Runs, nil
}

func validateTaskDir(dir string) error {
	for _, name := range []string{"task.md", "criteria.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return fmt.Errorf("%s: missing %s", dir, name)
		}
	}
	return nil
}

// --- Scaffolding ---

func dockerfileTemplateForAgent(agent string) ([]byte, error) {
	switch agent {
	case "claude":
		return dockerfileClaudeTemplate, nil
	case "codex":
		return dockerfileCodexTemplate, nil
	default:
		return nil, fmt.Errorf("unknown agent %q (must be claude or codex)", agent)
	}
}

func scaffoldTask(dir string, taskMD, criteriaJSON []byte, packMD string, withContext bool, tmplData templateData, agent string) error {
	dirs := []string{
		filepath.Join(dir, "environment", "judge"),
		filepath.Join(dir, "tests"),
	}
	if withContext && agent != "codex" {
		dirs = append(dirs, filepath.Join(dir, "environment", ".claude"))
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", d, err)
		}
	}

	taskToml, err := renderTemplate(taskTomlTmpl, tmplData)
	if err != nil {
		return fmt.Errorf("render task.toml: %w", err)
	}
	testSh, err := renderTemplate(testShTmpl, tmplData)
	if err != nil {
		return fmt.Errorf("render test.sh: %w", err)
	}
	dockerfileTemplate, err := dockerfileTemplateForAgent(agent)
	if err != nil {
		return err
	}

	files := map[string][]byte{
		filepath.Join(dir, "task.toml"):                              []byte(taskToml),
		filepath.Join(dir, "instruction.md"):                         taskMD,
		filepath.Join(dir, "environment", "Dockerfile"):              dockerfileTemplate,
		filepath.Join(dir, "environment", "judge", "retry.js"):       judgeRetryJS,
		filepath.Join(dir, "environment", "judge", "judge.js"):       judgeJS,
		filepath.Join(dir, "environment", "judge", "judge-codex.js"): judgeCodexJS,
		filepath.Join(dir, "environment", "judge", "package.json"):   judgePackageJSON,
		filepath.Join(dir, "tests", "criteria.json"):                 criteriaJSON,
	}
	for path, content := range files {
		if err := os.WriteFile(path, content, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", path, err)
		}
	}

	// test.sh needs execute permission
	if err := os.WriteFile(filepath.Join(dir, "tests", "test.sh"), []byte(testSh), 0o755); err != nil {
		return fmt.Errorf("write test.sh: %w", err)
	}

	if withContext {
		content := fmt.Sprintf("# Context Pack\n\n%s", packMD)
		if agent == "codex" {
			path := filepath.Join(dir, "environment", "AGENTS.md")
			if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
				return fmt.Errorf("write AGENTS.md: %w", err)
			}
		} else {
			path := filepath.Join(dir, "environment", ".claude", "CLAUDE.md")
			if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
				return fmt.Errorf("write CLAUDE.md: %w", err)
			}
		}
	}

	return nil
}

// --- Harbor invocation ---

// setupAgentsDir writes the embedded Python agent to a temp directory
// so Harbor can import it via PYTHONPATH.
func setupAgentsDir(baseDir string) (string, error) {
	agentsDir := filepath.Join(baseDir, "agents")
	if err := os.MkdirAll(agentsDir, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(agentsDir, "__init__.py"), []byte(""), 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(agentsDir, "claude_code_moltnet.py"), agentPython, 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(agentsDir, "headless_prompt.py"), agentPromptPython, 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(agentsDir, "codex_moltnet.py"), agentCodexPython, 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(agentsDir, "retry.py"), agentRetryPython, 0o644); err != nil {
		return "", err
	}
	return baseDir, nil
}

func runHarbor(workDir, tasksDir, agentsDir, model, agent, judgeModel string, concurrency int, forceBuild bool) error {
	agentImportPath := "agents.claude_code_moltnet:ClaudeCodeMoltNet"
	if agent == "codex" {
		agentImportPath = "agents.codex_moltnet:CodexMoltNet"
	}

	args := []string{
		"run",
		"-p", tasksDir,
		"--agent-import-path", agentImportPath,
		"--model", model,
		"--n-concurrent", strconv.Itoa(concurrency),
		"-y",
	}
	if forceBuild {
		args = append(args, "--force-build")
	}

	cmd := exec.Command("harbor", args...)
	cmd.Dir = workDir // Harbor writes jobs/ relative to CWD
	cmd.Env = append(os.Environ(),
		"PYTHONPATH="+agentsDir,
		"JUDGE_MODEL="+judgeModel,
	)
	cmd.Stdout = os.Stderr // Harbor progress + results to stderr
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// --- Summary formatting ---

func printSummary(results []evalResult, model string) {
	if len(results) == 1 {
		printSingleSummary(results[0], model)
		return
	}
	printBatchSummary(results, model)
}

func printCriterionEvidence(s *trialScores, label string) {
	if s == nil || len(s.scoredCriteria) == 0 {
		return
	}
	fmt.Printf("\n  Evidence (%s):\n", label)
	for _, sc := range s.scoredCriteria {
		pct := 0.0
		if sc.MaxScore > 0 {
			pct = sc.Score / sc.MaxScore * 100
		}
		evidence := sc.Evidence
		if evidence == "" {
			evidence = "—"
		}
		fmt.Printf("    %.0f%%  %-30s  %s\n", pct, sc.Name, evidence)
	}
}

func printVariantLine(label string, s *trialScores) {
	if s == nil {
		return
	}
	fmt.Printf("  %-18s  %.2f  (%.1f%%)", label+":", s.reward, s.reward*100)
	if s.err != "" {
		fmt.Printf("  ⚠ %s", s.err)
	}
	fmt.Println()
}

func printRunPaths(jobDir string) {
	fmt.Printf("Run output: %s\n", jobDir)
	fmt.Printf("Result file: %s\n", filepath.Join(jobDir, "result.json"))
}

func groupHeaderLine(index, total int, group runGroup) string {
	return fmt.Sprintf(
		"Group %d/%d: agent=%s model=%s (%d task(s))",
		index+1,
		total,
		group.agent,
		group.model,
		len(group.inputs),
	)
}

func evalRunCompletionError(results []evalResult, hasErrors bool) error {
	if len(results) == 0 {
		return fmt.Errorf("no results found — all trials may have failed")
	}
	if hasErrors {
		return fmt.Errorf("one or more trials reported errors")
	}
	return nil
}

func printSingleSummary(r evalResult, model string) {
	fmt.Printf("Eval: %s\n", r.taskName)
	if model != "" {
		fmt.Printf("Model: %s\n", model)
	}
	fmt.Println()

	printVariantLine("Without context", r.withoutContext)
	printVariantLine("With context", r.withContext)

	if r.withoutContext != nil && r.withContext != nil {
		delta := r.withContext.reward - r.withoutContext.reward
		fmt.Printf("  Delta:              %+.2f  (%+.1f%%)\n", delta, delta*100)
	}

	// Print per-criterion comparison
	if r.withoutContext != nil && r.withContext != nil &&
		(len(r.withoutContext.details) > 0 || len(r.withContext.details) > 0) {
		// Collect all criterion names from both variants
		allCriteria := make(map[string]bool)
		for k := range r.withoutContext.details {
			allCriteria[k] = true
		}
		for k := range r.withContext.details {
			allCriteria[k] = true
		}
		// Sort criteria for deterministic output
		sortedCriteria := make([]string, 0, len(allCriteria))
		for k := range allCriteria {
			sortedCriteria = append(sortedCriteria, k)
		}
		sort.Strings(sortedCriteria)

		fmt.Printf("\n  %-38s  %-9s  %-9s  %s\n", "Criteria", "Without", "With", "Delta")
		fmt.Printf("  %-38s  %-9s  %-9s  %s\n",
			strings.Repeat("─", 38), strings.Repeat("─", 9), strings.Repeat("─", 9), strings.Repeat("─", 7))
		for _, name := range sortedCriteria {
			without := r.withoutContext.details[name]
			with := r.withContext.details[name]
			d := with - without
			delta := ""
			if d != 0 {
				delta = fmt.Sprintf("%+.0f%%", d*100)
			}
			fmt.Printf("  %-38s  %-9s  %-9s  %s\n",
				name,
				fmt.Sprintf("%.0f%%", without*100),
				fmt.Sprintf("%.0f%%", with*100),
				delta,
			)
		}
	} else {
		// Single variant — just list scores
		single := r.withContext
		if single == nil {
			single = r.withoutContext
		}
		if single != nil && len(single.details) > 0 {
			fmt.Printf("\n  Criteria:\n")
			for name, score := range single.details {
				fmt.Printf("    %.0f%%  %s\n", score*100, name)
			}
		}
	}

	// Show per-criterion evidence when available (dspy engine)
	printCriterionEvidence(r.withoutContext, "without context")
	printCriterionEvidence(r.withContext, "with context")

	// Show log paths for failed trials
	for _, s := range []*trialScores{r.withoutContext, r.withContext} {
		if s != nil && s.err != "" {
			switch {
			case s.logDir != "":
				fmt.Printf("\n  Logs: %s/\n", s.logDir)
			case s.name != "":
				fmt.Printf("\n  Logs: %s/\n", s.name)
			}
		}
	}
	fmt.Println()
}

func printBatchSummary(results []evalResult, model string) {
	if model != "" {
		fmt.Printf("Model: %s\n\n", model)
	}
	fmt.Printf("  %-30s  %-9s  %-9s  %s\n", "Task", "Without", "With", "Delta")
	fmt.Printf("  %-30s  %-9s  %-9s  %s\n",
		strings.Repeat("─", 30), strings.Repeat("─", 9), strings.Repeat("─", 9), strings.Repeat("─", 8))

	var deltas []float64
	for _, r := range results {
		without := "—"
		with := "—"
		delta := "—"

		if r.withoutContext != nil {
			if r.withoutContext.err != "" {
				without = "FAILED"
			} else {
				without = fmt.Sprintf("%.1f%%", r.withoutContext.reward*100)
			}
		}
		if r.withContext != nil {
			if r.withContext.err != "" {
				with = "FAILED"
			} else {
				with = fmt.Sprintf("%.1f%%", r.withContext.reward*100)
			}
		}
		if r.withoutContext != nil && r.withContext != nil &&
			r.withoutContext.err == "" && r.withContext.err == "" {
			d := r.withContext.reward - r.withoutContext.reward
			delta = fmt.Sprintf("%+.1f%%", d*100)
			deltas = append(deltas, d)
		}

		fmt.Printf("  %-30s  %-9s  %-9s  %s\n", r.taskName, without, with, delta)
	}

	// Show error details for failed trials
	for _, r := range results {
		for _, s := range []*trialScores{r.withoutContext, r.withContext} {
			if s != nil && s.err != "" {
				fmt.Printf("\n  %s: %s", s.name, s.err)
			}
		}
	}

	if len(deltas) > 0 {
		avg := 0.0
		for _, d := range deltas {
			avg += d
		}
		avg /= float64(len(deltas))
		if math.IsNaN(avg) {
			avg = 0
		}
		fmt.Printf("\n  Average delta: %+.1f%%\n", avg*100)
	}
	fmt.Println()
}

// --- Orchestration ---

func resolveEvalRun(scenarioDir, packPath, agent, model string) (evalRunInput, error) {
	manifest, err := validateScenario(scenarioDir)
	if err != nil {
		return evalRunInput{}, err
	}
	if manifest == nil {
		fmt.Fprintf(os.Stderr, "warning: %s has no eval.json — running with full worktree (Phase 1 fallback). Add eval.json with mode:vitro or mode:vivo to suppress this warning.\n", scenarioDir)
	}

	taskMD, err := os.ReadFile(filepath.Join(scenarioDir, "task.md"))
	if err != nil {
		return evalRunInput{}, fmt.Errorf("reading task.md from %s: %w", scenarioDir, err)
	}
	criteriaJSON, err := os.ReadFile(filepath.Join(scenarioDir, "criteria.json"))
	if err != nil {
		return evalRunInput{}, fmt.Errorf("reading criteria.json from %s: %w", scenarioDir, err)
	}

	// Resolve pack: CLI --pack flag takes precedence over eval.json pack.path.
	var packMD string
	if packPath != "" {
		data, err := os.ReadFile(packPath)
		if err != nil {
			return evalRunInput{}, fmt.Errorf("reading pack %s: %w", packPath, err)
		}
		packMD = string(data)
	} else if manifest != nil && manifest.Pack != nil && manifest.Pack.Path != "" {
		absPath := manifest.Pack.Path
		if !filepath.IsAbs(absPath) {
			absPath = filepath.Join(scenarioDir, absPath)
		}
		data, err := os.ReadFile(absPath)
		if err != nil {
			return evalRunInput{}, fmt.Errorf("reading pack from eval.json pack.path %s: %w", absPath, err)
		}
		packMD = string(data)
	}

	return evalRunInput{
		name:         filepath.Base(scenarioDir),
		taskMD:       taskMD,
		criteriaJSON: criteriaJSON,
		packMD:       packMD,
		agent:        agent,
		model:        model,
		manifest:     manifest,
	}, nil
}

func runEvalSingleTask(taskDir, packPath string, opts evalRunOpts) error {
	if err := checkPrerequisites(opts.engine, opts); err != nil {
		return err
	}
	input, err := resolveEvalRun(taskDir, packPath, opts.agent, opts.model)
	if err != nil {
		return err
	}
	if opts.engine == "dspy" {
		return runDSPYEvalSingleTask(input, opts)
	}
	return runEval([]evalRunInput{input}, opts)
}

func runEvalFromConfig(configPath string, opts evalRunOpts) error {
	if err := checkPrerequisites(opts.engine, opts); err != nil {
		return err
	}
	runs, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	var inputs []evalRunInput
	for _, r := range runs {
		agent := r.Agent
		if agent == "" {
			agent = opts.agent
		}
		model := r.Model
		if model == "" {
			model = opts.model
		}
		if err := validateAgentModel(agent, model); err != nil {
			return fmt.Errorf("run %q: %w", r.Scenario, err)
		}
		input, err := resolveEvalRun(r.Scenario, r.Pack, agent, model)
		if err != nil {
			return err
		}
		inputs = append(inputs, input)
	}
	if opts.engine == "dspy" {
		return runDSPYEvalBatch(inputs, opts)
	}
	return runEval(inputs, opts)
}

type evalChecklistCriteria struct {
	Type      string                `json:"type"`
	Context   string                `json:"context"`
	Checklist []checklist.Criterion `json:"checklist"`
}

// evalManifest is the per-scenario eval.json schema.
type evalManifest struct {
	Mode    string              `json:"mode"`
	Fixture evalManifestFixture `json:"fixture"`
	Pack    *evalManifestPack   `json:"pack,omitempty"`
}

type evalManifestFixture struct {
	Ref     string   `json:"ref,omitempty"`
	Exclude []string `json:"exclude,omitempty"`
	Include []string `json:"include,omitempty"`
}

type evalManifestPack struct {
	Path string `json:"path"`
}

// loadEvalManifest reads and JSON-parses eval.json from a scenario directory.
// It returns (nil, nil) if the file is absent (Phase 1 fallback: handled by
// validateScenario, which prints a warning). Strict unmarshaling rejects
// unknown top-level keys, but semantic validation of the mode value, fixture
// fields, and pack contents is intentionally deferred to validateScenario
// (Task 2) so this loader stays a pure parser.
func loadEvalManifest(scenarioDir string) (*evalManifest, error) {
	p := filepath.Join(scenarioDir, "eval.json")
	data, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading eval.json: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var m evalManifest
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("parsing eval.json: %w", err)
	}
	return &m, nil
}

// validateScenario validates task.md, criteria.json, and eval.json (if present).
// Returns the parsed evalManifest (nil if eval.json is absent — Phase 1 fallback).
// Hard-errors on malformed JSON, invalid criteria, or invalid eval.json semantics.
func validateScenario(dir string) (*evalManifest, error) {
	if err := validateTaskDir(dir); err != nil {
		return nil, err
	}

	criteriaData, err := os.ReadFile(filepath.Join(dir, "criteria.json"))
	if err != nil {
		return nil, fmt.Errorf("reading criteria.json: %w", err)
	}
	if err := validateCriteriaJSON(criteriaData); err != nil {
		return nil, fmt.Errorf("criteria.json in %s: %w", dir, err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		return nil, fmt.Errorf("eval.json in %s: %w", dir, err)
	}
	if m == nil {
		return nil, nil
	}
	if err := validateEvalManifest(m); err != nil {
		return nil, fmt.Errorf("eval.json in %s: %w", dir, err)
	}
	return m, nil
}

func validateCriteriaJSON(data []byte) error {
	var c evalChecklistCriteria
	if err := json.Unmarshal(data, &c); err != nil {
		return fmt.Errorf("parse error: %w", err)
	}
	if c.Type != "" && c.Type != "weighted_checklist" {
		return fmt.Errorf("unsupported type %q (must be weighted_checklist)", c.Type)
	}
	if len(c.Checklist) == 0 {
		return fmt.Errorf("checklist must be non-empty")
	}
	var total float64
	for i, item := range c.Checklist {
		if strings.TrimSpace(item.Name) == "" {
			return fmt.Errorf("checklist[%d]: name must be non-empty", i)
		}
		if strings.TrimSpace(item.Description) == "" {
			return fmt.Errorf("checklist[%d]: description must be non-empty", i)
		}
		if item.MaxScore <= 0 {
			return fmt.Errorf("checklist[%d]: max_score must be positive, got %v", i, item.MaxScore)
		}
		total += item.MaxScore
	}
	if total != 100 {
		return fmt.Errorf("checklist max_score values must sum to 100, got %v", total)
	}
	return nil
}

func validateEvalManifest(m *evalManifest) error {
	switch m.Mode {
	case "vitro":
		if m.Fixture.Ref != "" {
			return fmt.Errorf("mode vitro: fixture.ref must be empty (ref is irrelevant in vitro mode)")
		}
		for i, g := range m.Fixture.Include {
			if strings.TrimSpace(g) == "" {
				return fmt.Errorf("fixture.include[%d]: must be non-empty", i)
			}
		}
	case "vivo":
		if strings.TrimSpace(m.Fixture.Ref) == "" {
			return fmt.Errorf("mode vivo: fixture.ref is required")
		}
	default:
		return fmt.Errorf("mode must be vitro or vivo, got %q", m.Mode)
	}
	for i, g := range m.Fixture.Exclude {
		if strings.TrimSpace(g) == "" {
			return fmt.Errorf("fixture.exclude[%d]: must be non-empty", i)
		}
	}
	if m.Pack != nil && strings.TrimSpace(m.Pack.Path) == "" {
		return fmt.Errorf("pack.path must be non-empty if pack is set")
	}
	return nil
}

func runDSPYEvalSingleTask(input evalRunInput, opts evalRunOpts) error {
	if err := validateDSPYEvalOpts(opts); err != nil {
		return err
	}
	repoRoot, sourceRef, err := resolveDSPYEvalSource(opts, input.manifest)
	if err != nil {
		return err
	}
	opts.dspyRepoRoot = repoRoot
	opts.dspySourceRef = sourceRef

	group := runGroup{agent: input.agent, model: input.model, inputs: []evalRunInput{input}}
	header := groupHeaderLine(0, 1, group)
	fmt.Fprintln(os.Stderr, header)
	fmt.Fprintln(os.Stdout, header)

	startedAt := time.Now()
	runDir, err := os.MkdirTemp("", "moltnet-eval-dspy-*")
	if err != nil {
		return fmt.Errorf("creating temp dir: %w", err)
	}
	defer func() {
		fmt.Fprintf(os.Stderr, "Artifacts preserved at: %s\n", runDir)
	}()

	pt := newProgressTracker(os.Stderr)
	defer pt.wait()

	result := evalResult{taskName: input.name}
	if input.packMD != "" && opts.concurrency >= 2 {
		// Run without-context and with-context variants in parallel.
		var wg sync.WaitGroup
		var withoutScores, withScores *trialScores
		var withoutErr, withErr error

		wg.Add(2)
		go func() {
			defer wg.Done()
			tb := pt.addTrial(input.name + " (without context)")
			withoutScores, withoutErr = runDSPYEvalVariant(runDir, input, false, opts, tb)
		}()
		go func() {
			defer wg.Done()
			tb := pt.addTrial(input.name + " (with context)")
			withScores, withErr = runDSPYEvalVariant(runDir, input, true, opts, tb)
		}()
		wg.Wait()

		if withoutErr != nil {
			return withoutErr
		}
		if withErr != nil {
			return withErr
		}
		result.withoutContext = withoutScores
		result.withContext = withScores
	} else {
		tb := pt.addTrial(input.name + " (without context)")
		result.withoutContext, err = runDSPYEvalVariant(runDir, input, false, opts, tb)
		if err != nil {
			return err
		}
		if input.packMD != "" {
			tb2 := pt.addTrial(input.name + " (with context)")
			result.withContext, err = runDSPYEvalVariant(runDir, input, true, opts, tb2)
			if err != nil {
				return err
			}
		}
	}

	if err := writeJobResultSummary(runDir, "dspy", startedAt, []evalResult{result}, opts); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not write dspy result summary: %v\n", err)
	}

	printRunPaths(runDir)
	printSummary([]evalResult{result}, "")
	hasErrors := (result.withoutContext != nil && result.withoutContext.err != "") ||
		(result.withContext != nil && result.withContext.err != "")
	return evalRunCompletionError([]evalResult{result}, hasErrors)
}

func runDSPYEvalBatch(inputs []evalRunInput, opts evalRunOpts) error {
	if err := validateDSPYEvalOpts(opts); err != nil {
		return err
	}
	// Validate per-input agent overrides (config mode can specify per-run agents).
	for _, in := range inputs {
		if in.agent != "" {
			switch in.agent {
			case "claude", "codex":
			default:
				return fmt.Errorf("scenario %q: --engine dspy supports --agent claude or codex (got %q)", in.name, in.agent)
			}
		}
	}
	// Default batch source ref (nil manifest -> HEAD or CLI --fixture-ref).
	// Per-input manifests with their own fixture.ref are resolved inside the
	// per-input goroutine below so each scenario can pin its own commit.
	repoRoot, sourceRef, err := resolveDSPYEvalSource(opts, nil)
	if err != nil {
		return err
	}
	opts.dspyRepoRoot = repoRoot
	opts.dspySourceRef = sourceRef

	startedAt := time.Now()
	runDir, err := os.MkdirTemp("", "moltnet-eval-dspy-batch-*")
	if err != nil {
		return fmt.Errorf("creating temp dir: %w", err)
	}
	defer func() {
		fmt.Fprintf(os.Stderr, "Artifacts preserved at: %s\n", runDir)
	}()

	type indexedResult struct {
		idx    int
		result evalResult
		err    error
	}

	// Dedup scenario names to avoid artifact directory collisions.
	nameCounts := make(map[string]int, len(inputs))
	for i := range inputs {
		nameCounts[inputs[i].name]++
		if nameCounts[inputs[i].name] > 1 {
			inputs[i].name = fmt.Sprintf("%s-%d", inputs[i].name, nameCounts[inputs[i].name])
		}
	}

	pt := newProgressTracker(os.Stderr)
	defer pt.wait()

	sem := make(chan struct{}, max(opts.concurrency, 1))
	results := make([]evalResult, len(inputs))
	ch := make(chan indexedResult, len(inputs))

	for i, input := range inputs {
		sem <- struct{}{}
		go func(idx int, in evalRunInput) {
			defer func() { <-sem }()
			r := evalResult{taskName: in.name}
			var runErr error

			// Per-input source resolution: honor each scenario's eval.json fixture.ref.
			inputOpts := opts
			if in.manifest != nil && in.manifest.Fixture.Ref != "" && opts.dspyFixtureRef == "" {
				perRepo, perRef, perErr := resolveDSPYEvalSource(opts, in.manifest)
				if perErr != nil {
					ch <- indexedResult{idx: idx, err: perErr}
					return
				}
				inputOpts.dspyRepoRoot = perRepo
				inputOpts.dspySourceRef = perRef
			}

			tb := pt.addTrial(in.name + " (without context)")
			r.withoutContext, runErr = runDSPYEvalVariant(runDir, in, false, inputOpts, tb)
			if runErr != nil {
				ch <- indexedResult{idx: idx, err: runErr}
				return
			}
			if in.packMD != "" {
				tb2 := pt.addTrial(in.name + " (with context)")
				r.withContext, runErr = runDSPYEvalVariant(runDir, in, true, inputOpts, tb2)
				if runErr != nil {
					ch <- indexedResult{idx: idx, err: runErr}
					return
				}
			}
			ch <- indexedResult{idx: idx, result: r}
		}(i, input)
	}

	var firstErr error
	hasErrors := false
	for range inputs {
		ir := <-ch
		if ir.err != nil && firstErr == nil {
			firstErr = ir.err
			continue
		}
		results[ir.idx] = ir.result
		if (ir.result.withoutContext != nil && ir.result.withoutContext.err != "") ||
			(ir.result.withContext != nil && ir.result.withContext.err != "") {
			hasErrors = true
		}
	}
	if firstErr != nil {
		return firstErr
	}

	if err := writeJobResultSummary(runDir, "dspy", startedAt, results, opts); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not write dspy batch result summary: %v\n", err)
	}

	printRunPaths(runDir)
	printSummary(results, "")
	return evalRunCompletionError(results, hasErrors)
}

func validateDSPYEvalOpts(opts evalRunOpts) error {
	switch opts.agent {
	case "claude", "codex":
	default:
		return fmt.Errorf("--engine dspy supports --agent claude or codex, got %q", opts.agent)
	}
	switch opts.judge {
	case "claude", "codex":
	default:
		return fmt.Errorf("--engine dspy supports --judge claude or codex, got %q", opts.judge)
	}
	return nil
}

func runDSPYEvalVariant(runDir string, input evalRunInput, withContext bool, opts evalRunOpts, tb *trialBar) (_ *trialScores, retErr error) {
	defer func() {
		if retErr != nil && tb != nil {
			tb.fail(retErr.Error())
		}
	}()

	variantName := input.name
	if withContext {
		variantName += "-with-context"
	}
	variantDir := filepath.Join(runDir, variantName+"__dspy")
	if err := os.MkdirAll(variantDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating variant dir: %w", err)
	}

	worktreeDir, cleanupWorktree, err := createDSPYEvalWorktree(variantDir, variantName, opts, input.manifest)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := cleanupWorktree(); err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not remove dspy worktree %s: %v\n", worktreeDir, err)
		}
	}()

	agentName := input.agent
	if agentName == "" {
		agentName = opts.agent
	}
	if tb != nil {
		tb.setPhase(phaseAgentRunning)
	}
	if withContext && strings.TrimSpace(input.packMD) != "" {
		if err := writeDSPYEvalPackToDisk(worktreeDir, input.packMD); err != nil {
			return nil, fmt.Errorf("write pack to disk: %w", err)
		}
	}

	model := input.model
	if model == "" {
		model = opts.model
	}

	agentResult, err := runSolver(solverInput{
		workDir:     worktreeDir,
		agent:       agentName,
		model:       model,
		taskMD:      string(input.taskMD),
		packMD:      input.packMD,
		withContext: withContext,
		kind:        opts.solverKind,
		tb:          tb,
	})
	if err != nil {
		return nil, err
	}

	filesSnapshot, err := buildWorkspaceSnapshot(worktreeDir, agentResult.output)
	if err != nil {
		return nil, fmt.Errorf("snapshot workspace: %w", err)
	}

	criteria, err := parseChecklistCriteria(input.criteriaJSON)
	if err != nil {
		return nil, err
	}

	scores := &trialScores{
		name:   filepath.Base(variantDir),
		logDir: variantDir,
	}
	if !agentResult.passed {
		if err := writeDSPYAgentArtifacts(variantDir, agentResult); err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not persist failed agent output for %s: %v\n", variantName, err)
		}
		scores.err = agentResult.output
		if scores.err == "" {
			scores.err = "agent run failed"
		}
		if tb != nil {
			tb.fail(scores.err)
		}
		return scores, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Create a fresh judge LLM per variant to avoid sharing lastUsage
	// state across concurrent goroutines in batch mode.
	judgeProvider, judgeModelBare := dspyJudgeProvider(opts.judge, opts.judgeModel)
	judgeLLM, err := dspyadapters.InitProvider(judgeProvider, judgeModelBare)
	if err != nil {
		return nil, fmt.Errorf("initialize judge LLM: %w", err)
	}

	if tb != nil {
		tb.setPhase(phaseJudging)
	}
	judgeStart := time.Now()
	judged, err := checklist.Run(ctx, checklist.Request{
		LLM:              judgeLLM,
		WorkspaceSummary: filesSnapshot,
		Criteria: checklist.Criteria{
			Type:      criteria.Type,
			Context:   criteria.Context,
			Checklist: criteria.Checklist,
		},
	})
	judgeMs := time.Since(judgeStart).Milliseconds()
	if err != nil {
		scores.err = formatDSPyJudgeError(err).Error()
		// Still write agent artifacts on judge failure
		if writeErr := writeDSPYAgentArtifacts(variantDir, agentResult); writeErr != nil {
			fmt.Fprintf(os.Stderr, "warning: could not persist agent output for %s: %v\n", variantName, writeErr)
		}
		if tb != nil {
			tb.fail(scores.err)
		}
		return scores, nil
	}

	scores.reward = judged.Reward
	scores.details = judged.Details
	scores.scoredCriteria = judged.Scores

	variant := "without-context"
	if withContext {
		variant = "with-context"
	}
	if err := writeDSPYVariantArtifacts(variantDir, agentResult, judged, judgeMs, input.name, variant, agentName, model, opts); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not persist dspy artifacts for %s: %v\n", variantName, err)
	}
	if tb != nil {
		tb.complete(scores.reward)
	}
	return scores, nil
}

func createDSPYEvalWorktree(parentDir, label string, opts evalRunOpts, manifest *evalManifest) (string, func() error, error) {
	if opts.dspyRepoRoot == "" || opts.dspySourceRef == "" {
		return "", nil, fmt.Errorf("missing frozen dspy source ref")
	}

	worktreeDir := filepath.Join(parentDir, "workspace")
	worktreeMu.Lock()
	addErr := gitRun(opts.dspyRepoRoot, "worktree", "add", "--detach", worktreeDir, opts.dspySourceRef)
	worktreeMu.Unlock()
	if addErr != nil {
		return "", nil, fmt.Errorf("create dspy worktree for %s: %w", label, addErr)
	}

	mode := dspyEvalMode(manifest, opts)
	var neutralizeErr error
	switch mode {
	case "vitro":
		include := []string{"task.md"}
		if manifest != nil && len(manifest.Fixture.Include) > 0 {
			include = manifest.Fixture.Include
		}
		neutralizeErr = sparsePassDSPYEvalWorktree(worktreeDir, include)
	default:
		neutralizeErr = neutralizeDSPYEvalWorktree(worktreeDir, newDSPYWorktreeFilter(opts, manifest))
	}
	if neutralizeErr != nil {
		worktreeMu.Lock()
		cleanupErr := gitRun(opts.dspyRepoRoot, "worktree", "remove", "--force", worktreeDir)
		worktreeMu.Unlock()
		if cleanupErr != nil {
			return "", nil, fmt.Errorf("neutralize dspy worktree: %w; cleanup worktree: %v", neutralizeErr, cleanupErr)
		}
		return "", nil, fmt.Errorf("neutralize dspy worktree: %w", neutralizeErr)
	}

	cleanup := func() error {
		worktreeMu.Lock()
		defer worktreeMu.Unlock()
		return gitRun(opts.dspyRepoRoot, "worktree", "remove", "--force", worktreeDir)
	}
	return worktreeDir, cleanup, nil
}

func resolveDSPYEvalSource(opts evalRunOpts, manifest *evalManifest) (string, string, error) {
	repoRoot, err := currentRepoRoot()
	if err != nil {
		return "", "", err
	}
	ref := ""
	if opts.dspyFixtureRef != "" {
		ref = opts.dspyFixtureRef
	} else if manifest != nil && manifest.Fixture.Ref != "" {
		ref = manifest.Fixture.Ref
	}
	if ref == "" {
		headRef, err := gitOutput(repoRoot, "rev-parse", "HEAD")
		if err != nil {
			return "", "", fmt.Errorf("resolve dspy source ref: %w", err)
		}
		return repoRoot, strings.TrimSpace(headRef), nil
	}
	resolvedRef, err := gitOutput(repoRoot, "rev-parse", "--verify", ref)
	if err != nil {
		return "", "", fmt.Errorf("fixture.ref %q does not resolve in this repo: %w", ref, err)
	}
	return repoRoot, strings.TrimSpace(resolvedRef), nil
}

func currentRepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("get working directory: %w", err)
	}
	root, err := gitOutput(wd, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("resolve repo root: %w", err)
	}
	return strings.TrimSpace(root), nil
}

func gitOutput(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func gitRun(cwd string, args ...string) error {
	// Buffer git's output so its "Preparing worktree (...)" lines don't
	// interleave with mpb's cursor-movement redraws. Only emit on error.
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		if buf.Len() > 0 {
			fmt.Fprint(os.Stderr, buf.String())
		}
		return err
	}
	return nil
}

func neutralizeDSPYEvalWorktree(worktreeDir string, filter dspyWorktreeFilter) error {
	return filepath.WalkDir(worktreeDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if path == worktreeDir {
			return nil
		}
		if d.IsDir() {
			if filepath.Base(path) == ".git" {
				return filepath.SkipDir
			}
			if filter.matches(relPath(worktreeDir, path), true) {
				if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
					return err
				}
				return filepath.SkipDir
			}
			return nil
		}
		if filter.matches(relPath(worktreeDir, path), false) {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return nil
	})
}

// sparsePassDSPYEvalWorktree removes everything from worktreeDir except:
// - paths listed in include (relative to worktreeDir)
// - the .git directory (required for git worktree management)
// Runner-written files (context-pack.md, CLAUDE.md, AGENTS.md) are written
// by writeDSPYEvalPackToDisk AFTER this pass, so they don't need to be listed.
func sparsePassDSPYEvalWorktree(worktreeDir string, include []string) error {
	allowset := make(map[string]bool, len(include)+1)
	for _, p := range include {
		p = strings.Trim(strings.TrimSpace(filepath.ToSlash(p)), "/")
		if p != "" {
			allowset[p] = true
		}
	}

	return filepath.WalkDir(worktreeDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if path == worktreeDir {
			return nil
		}
		rel := relPath(worktreeDir, path)
		if d.IsDir() && filepath.Base(path) == ".git" {
			return filepath.SkipDir
		}
		if d.IsDir() {
			hasAllowedChild := false
			for allowed := range allowset {
				if strings.HasPrefix(allowed, rel+"/") {
					hasAllowedChild = true
					break
				}
			}
			if !hasAllowedChild && !allowset[rel] {
				if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
					return err
				}
				return filepath.SkipDir
			}
			return nil
		}
		if !allowset[rel] {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return nil
	})
}

func relPath(base, path string) string {
	rel, err := filepath.Rel(base, path)
	if err != nil {
		return path
	}
	return filepath.ToSlash(rel)
}

func (f dspyWorktreeFilter) matches(rel string, isDir bool) bool {
	rel = strings.Trim(strings.TrimSpace(filepath.ToSlash(rel)), "/")
	if rel == "" {
		return false
	}
	for _, glob := range f.excludeGlobs {
		glob = strings.Trim(strings.TrimSpace(filepath.ToSlash(glob)), "/")
		if glob == "" {
			continue
		}
		if glob == rel {
			return true
		}
		if strings.HasSuffix(glob, "/**") {
			prefix := strings.TrimSuffix(glob, "/**")
			if rel == prefix || strings.HasPrefix(rel, prefix+"/") {
				return true
			}
		}
		matched, err := doublestarMatch(glob, rel)
		if err == nil && matched {
			return true
		}
		if isDir {
			matched, err = doublestarMatch(filepath.ToSlash(filepath.Join(glob, "*")), rel)
			if err == nil && matched {
				return true
			}
		}
	}
	return false
}

func doublestarMatch(pattern, name string) (bool, error) {
	pattern = strings.Trim(strings.TrimSpace(filepath.ToSlash(pattern)), "/")
	name = strings.Trim(strings.TrimSpace(filepath.ToSlash(name)), "/")
	return matchSegments(strings.Split(pattern, "/"), strings.Split(name, "/"))
}

func matchSegments(patternParts, nameParts []string) (bool, error) {
	if len(patternParts) == 0 {
		return len(nameParts) == 0, nil
	}

	if patternParts[0] == "**" {
		if len(patternParts) == 1 {
			return true, nil
		}
		for i := 0; i <= len(nameParts); i++ {
			matched, err := matchSegments(patternParts[1:], nameParts[i:])
			if err != nil {
				return false, err
			}
			if matched {
				return true, nil
			}
		}
		return false, nil
	}

	if len(nameParts) == 0 {
		return false, nil
	}

	matched, err := path.Match(patternParts[0], nameParts[0])
	if err != nil || !matched {
		return false, err
	}
	return matchSegments(patternParts[1:], nameParts[1:])
}

func parseChecklistCriteria(data []byte) (*evalChecklistCriteria, error) {
	var criteria evalChecklistCriteria
	if err := json.Unmarshal(data, &criteria); err != nil {
		return nil, fmt.Errorf("parsing criteria.json: %w", err)
	}
	if criteria.Type != "" && criteria.Type != "weighted_checklist" {
		return nil, fmt.Errorf("unsupported criteria type %q for --engine dspy", criteria.Type)
	}
	return &criteria, nil
}

// writeDSPYEvalPackToDisk writes the context pack to disk in the worktree so
// both the agent and the judge can observe what context was provided.
//
// Three files are written:
//   - context-pack.md — canonical pack content; picked up by the workspace
//     snapshot so the judge sees exactly what was provided to the agent.
//   - .claude/CLAUDE.md — @-imports context-pack.md so Claude Code loads it as
//     project context automatically. Written under .claude/ to match the
//     established scaffoldTask pattern used by the Harbor adapter.
//   - AGENTS.md — inline copy of the pack content; Codex reads AGENTS.md as
//     its system context but does not support the @file import syntax.
//
// The neutralizer always removes CLAUDE.md, AGENTS.md, and .claude/** from the
// cloned worktree before this runs, so these writes are always clean (no risk
// of appending to or clobbering the repo's own config files).
func writeDSPYEvalPackToDisk(worktreeDir, packMD string) error {
	packContent := "# Context Pack\n\n" + packMD

	if err := os.WriteFile(filepath.Join(worktreeDir, "context-pack.md"), []byte(packContent), 0o644); err != nil {
		return fmt.Errorf("write context-pack.md: %w", err)
	}
	// Claude Code supports @file imports; write under .claude/ to match the
	// scaffoldTask convention used in the Harbor adapter.
	claudeDir := filepath.Join(worktreeDir, ".claude")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		return fmt.Errorf("mkdir .claude: %w", err)
	}
	if err := os.WriteFile(filepath.Join(claudeDir, "CLAUDE.md"), []byte("@../context-pack.md\n"), 0o644); err != nil {
		return fmt.Errorf("write .claude/CLAUDE.md: %w", err)
	}
	// Codex does not support @file imports in AGENTS.md (openai/codex#6038,
	// openai/codex#13386), so inline the content directly.
	if err := os.WriteFile(filepath.Join(worktreeDir, "AGENTS.md"), []byte(packContent), 0o644); err != nil {
		return fmt.Errorf("write AGENTS.md: %w", err)
	}
	return nil
}

type dspyAgentRunResult struct {
	passed     bool
	output     string // final text result
	stderr     string
	durationMs int64
	costUSD    float64
	numTurns   int
	sessionID  string
	// Token usage (aggregated across all turns).
	inputTokens       int
	cachedInputTokens int
	outputTokens      int
	trajectory        []json.RawMessage // raw stream-json events (assistant + result only)
}

// solverInput bundles everything one eval trial needs to drive the agent.
// It exists as the stable seam the dspy-go solver module (ChainOfThought
// for vitro, ReAct for vivo — see docs/superpowers/specs/2026-04-08-eval-solver-dspy-module.md
// and issue #714) will hook into.
type solverInput struct {
	workDir     string
	agent       string
	model       string
	taskMD      string
	packMD      string
	withContext bool
	kind        solver.Kind // KindChainOfThought when empty
	tb          *trialBar
}

// runSolver executes one eval trial via a dspy-go solver module and
// returns the captured agent result.
//
// The solver module (ChainOfThought for vitro today, ReAct once the tool
// registry lands for vivo — see
// docs/superpowers/specs/2026-04-08-eval-solver-dspy-module.md and issue
// #714) owns the signature and prompt construction. The underlying LLM
// is one of the CLI adapters (claudecode or codex), which internally
// stream CLI events and expose them via dspytypes.TrajectoryProvider so
// we still get rich per-trial artifacts (turn count, cost, trajectory).
func runSolver(in solverInput) (*dspyAgentRunResult, error) {
	var heartbeat dspytypes.HeartbeatFunc
	if in.tb != nil {
		heartbeat = dspytypes.HeartbeatFunc(in.tb.heartbeatFor())
	}

	// Construct a fresh LLM per trial. Adapters are not safe to share
	// across goroutines — LastTrajectory() is a per-instance side channel
	// populated by each Generate call.
	var llm core.LLM
	var trajProvider dspytypes.TrajectoryProvider
	switch in.agent {
	case "codex":
		adapter, err := codex.New(codex.Config{
			Model:       trimOpenAIModelPrefix(in.model),
			WorkDir:     in.workDir,
			SandboxMode: "workspace-write",
			IsolateHome: true,
			OnHeartbeat: heartbeat,
		})
		if err != nil {
			return nil, fmt.Errorf("init codex adapter: %w", err)
		}
		llm = adapter
		trajProvider = adapter
	default:
		adapter, err := claudecode.New(claudecode.Config{
			Model:              trimAnthropicModelPrefix(in.model),
			WorkDir:            in.workDir,
			IsolateFromSession: true,
			OnHeartbeat:        heartbeat,
		})
		if err != nil {
			return nil, fmt.Errorf("init claude adapter: %w", err)
		}
		llm = adapter
		trajProvider = adapter
	}

	kind := in.kind
	if kind == "" {
		kind = solver.KindChainOfThought
	}

	module, err := solver.New(solver.Config{
		Kind:      kind,
		Signature: solver.VitroSignature(),
		LLM:       llm,
	})
	if err != nil {
		return nil, fmt.Errorf("init solver module: %w", err)
	}

	// Only feed the pack to the signature on "with-context" variants.
	// The baseline variant must see an empty context_pack so with/without
	// comparisons measure the effect of the pack. The on-disk
	// context-pack.md (written by writeDSPYEvalPackToDisk) is already
	// gated by withContext upstream; this gate keeps the signature input
	// consistent with the filesystem state.
	contextPack := ""
	if in.withContext && strings.TrimSpace(in.packMD) != "" {
		contextPack = in.packMD
	}

	ctx := context.Background()
	// TODO(#714): capture module.Process outputs (reasoning,
	// workspace_summary) for GEPA once the optimizer lands. Today the
	// judge reads the filesystem as ground truth so these outputs are
	// narrative-only and deliberately discarded.
	_, procErr := module.Process(ctx, map[string]any{
		"task_markdown": in.taskMD,
		"context_pack":  contextPack,
	})

	// The module's returned map holds the dspy-go-parsed output fields
	// (reasoning, workspace_summary) which are narrative/GEPA-facing and
	// not load-bearing for the judge. The judge reads the filesystem via
	// buildWorkspaceSnapshot as ground truth. What we DO need here is the
	// CLI trajectory side channel: turn count, cost, session id, raw
	// events. That comes from trajProvider.LastTrajectory(), populated by
	// the adapter's Generate call that dspy-go just made.
	result := &dspyAgentRunResult{}
	if resp := trajProvider.LastTrajectory(); resp != nil {
		result.trajectory = resp.Trajectory
		result.output = resp.Content
		result.sessionID = resp.SessionID
		result.durationMs = resp.DurationMs
		result.costUSD = resp.CostUSD
		result.numTurns = resp.NumTurns
		if resp.Usage != nil {
			result.inputTokens = resp.Usage.PromptTokens
			result.outputTokens = resp.Usage.CompletionTokens
		}
		result.cachedInputTokens = resp.CacheReadTokens
	}

	if procErr != nil {
		if result.output == "" {
			result.output = procErr.Error()
		}
		return result, nil
	}

	result.passed = true
	return result, nil
}

func trimAnthropicModelPrefix(model string) string {
	return strings.TrimPrefix(model, "anthropic/")
}

func trimOpenAIModelPrefix(model string) string {
	return strings.TrimPrefix(model, "openai/")
}

// dspyJudgeProvider returns the dspy-adapters provider name and bare model
// for the given --judge value.
func dspyJudgeProvider(judge, judgeModel string) (provider, model string) {
	switch judge {
	case "codex":
		return "codex", trimOpenAIModelPrefix(judgeModel)
	default:
		return "claude-code", trimAnthropicModelPrefix(judgeModel)
	}
}

func buildWorkspaceSnapshot(workDir, fallbackOutput string) (string, error) {
	paths, err := listChangedSnapshotPaths(workDir)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	for _, rel := range paths {
		fullPath := filepath.Join(workDir, rel)
		info, err := os.Stat(fullPath)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", err
		}
		if info.IsDir() {
			continue
		}
		data, err := os.ReadFile(fullPath)
		if err != nil {
			return "", err
		}
		b.WriteString("## ")
		b.WriteString(rel)
		b.WriteString("\n")
		b.WriteString(string(data))
		b.WriteString("\n\n")
	}
	if b.Len() == 0 && strings.TrimSpace(fallbackOutput) != "" {
		b.WriteString("## final-response.txt\n")
		b.WriteString(fallbackOutput)
		b.WriteString("\n")
	}
	return b.String(), nil
}

func listChangedSnapshotPaths(workDir string) ([]string, error) {
	statusOut, err := gitOutput(workDir, "status", "--short")
	if err == nil {
		paths := parseGitStatusPaths(statusOut)
		if len(paths) > 0 {
			sort.Strings(paths)
			return paths, nil
		}
	}

	var paths []string
	err = filepath.WalkDir(workDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == workDir {
			return nil
		}
		name := filepath.Base(path)
		if d.IsDir() {
			if name == ".git" || strings.HasPrefix(name, ".claude") {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(workDir, path)
		if err != nil {
			return err
		}
		paths = append(paths, rel)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	return paths, nil
}

func parseGitStatusPaths(output string) []string {
	ignore := map[string]bool{
		"AGENTS.md": true,
		"CLAUDE.md": true,
	}
	paths := make([]string, 0)
	for _, raw := range strings.Split(output, "\n") {
		if len(raw) < 4 {
			continue
		}
		status := raw[:2]
		if strings.Contains(status, "D") {
			continue
		}
		path := strings.TrimSpace(raw[3:])
		if idx := strings.Index(path, " -> "); idx >= 0 {
			path = strings.TrimSpace(path[idx+4:])
		}
		if path == "" || ignore[path] || strings.HasPrefix(path, ".claude/") {
			continue
		}
		paths = append(paths, path)
	}
	return paths
}

func writeDSPYVariantArtifacts(variantDir string, agent *dspyAgentRunResult, judged *checklist.Result, judgeMs int64, scenarioName, variant, resolvedAgent, resolvedModel string, opts evalRunOpts) error {
	verifierDir := filepath.Join(variantDir, "verifier")
	if err := os.MkdirAll(verifierDir, 0o755); err != nil {
		return err
	}
	if err := writeDSPYAgentArtifacts(variantDir, agent); err != nil {
		return err
	}

	// Backward-compat: verifier/reward.json + verifier/scores.json
	rewardPayload, err := json.MarshalIndent(map[string]float64{"reward": judged.Reward}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(verifierDir, "reward.json"), rewardPayload, 0o644); err != nil {
		return err
	}
	scoresPayload, err := json.MarshalIndent(judged.Details, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(verifierDir, "scores.json"), scoresPayload, 0o644); err != nil {
		return err
	}
	if judged.Reasoning != "" {
		if err := os.WriteFile(filepath.Join(verifierDir, "reasoning.txt"), []byte(judged.Reasoning), 0o644); err != nil {
			return err
		}
	}

	// Phase 0 contract: trial_result.json
	jobID := filepath.Base(filepath.Dir(variantDir))
	tr := buildTrialResult(jobID, scenarioName, variant, agent, judged, judgeMs, resolvedAgent, resolvedModel, opts)
	trialPayload, err := json.MarshalIndent(tr, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(variantDir, "trial_result.json"), trialPayload, 0o644); err != nil {
		return err
	}

	// Phase 0 contract: trace.jsonl (judge execution trace)
	return writeJudgeTrace(variantDir, jobID, judgeMs, judged)
}

func writeDSPYAgentArtifacts(variantDir string, agent *dspyAgentRunResult) error {
	if err := os.WriteFile(filepath.Join(variantDir, "agent-output.txt"), []byte(agent.output), 0o644); err != nil {
		return err
	}
	if agent.stderr != "" {
		if err := os.WriteFile(filepath.Join(variantDir, "agent-stderr.txt"), []byte(agent.stderr), 0o644); err != nil {
			return err
		}
	}
	// Phase 0 contract: normalized trajectory.json
	if len(agent.trajectory) > 0 {
		traj := normalizeTrajectory(agent)
		trajectoryPayload, err := json.MarshalIndent(traj, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(variantDir, "trajectory.json"), trajectoryPayload, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func writeJudgeTrace(variantDir, traceID string, judgeMs int64, judged *checklist.Result) error {
	f, err := os.Create(filepath.Join(variantDir, "trace.jsonl"))
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)

	// Session start
	if err := enc.Encode(newTraceEvent("judge", "session", traceID, map[string]any{
		"start_time": time.Now().Add(-time.Duration(judgeMs) * time.Millisecond).UTC().Format(time.RFC3339),
	})); err != nil {
		return err
	}

	// Judge span
	if err := enc.Encode(newTraceEvent("judge", "span", traceID, map[string]any{
		"operation":   "module.process (checklist_judge)",
		"duration_ms": judgeMs,
		"success":     true,
		"reward":      judged.Reward,
		"criteria":    len(judged.Scores),
	})); err != nil {
		return err
	}

	return nil
}

func writeJobResultSummary(runDir, engine string, startedAt time.Time, results []evalResult, opts evalRunOpts) error {
	jobID := filepath.Base(runDir)
	jr := buildJobResult(jobID, engine, startedAt, results, opts)

	payload, err := json.MarshalIndent(jr, "", "  ")
	if err != nil {
		return err
	}
	// Write both for backward compat (result.json) and Phase 0 contract (job_result.json)
	if err := os.WriteFile(filepath.Join(runDir, "result.json"), payload, 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(runDir, "job_result.json"), payload, 0o644)
}

type runGroup struct {
	agent  string
	model  string
	inputs []evalRunInput
}

func groupRunsByAgentModel(inputs []evalRunInput) []runGroup {
	type groupKey struct {
		agent string
		model string
	}

	order := make([]groupKey, 0)
	grouped := make(map[groupKey][]evalRunInput)

	for _, input := range inputs {
		key := groupKey{agent: input.agent, model: input.model}
		if _, exists := grouped[key]; !exists {
			order = append(order, key)
		}
		grouped[key] = append(grouped[key], input)
	}

	sort.Slice(order, func(i, j int) bool {
		if order[i].agent != order[j].agent {
			return order[i].agent < order[j].agent
		}
		return order[i].model < order[j].model
	})

	groups := make([]runGroup, 0, len(order))
	for _, key := range order {
		groups = append(groups, runGroup{
			agent:  key.agent,
			model:  key.model,
			inputs: grouped[key],
		})
	}

	return groups
}

func runEval(inputs []evalRunInput, opts evalRunOpts) error {
	groups := groupRunsByAgentModel(inputs)

	var allResults []evalResult
	hasErrors := false

	for gi, group := range groups {
		header := groupHeaderLine(gi, len(groups), group)
		fmt.Fprintln(os.Stderr, header)
		fmt.Fprintln(os.Stdout, header)

		results, groupHasErrors, err := runEvalGroup(group, opts)
		if err != nil {
			return fmt.Errorf("group %s/%s: %w", group.agent, group.model, err)
		}
		allResults = append(allResults, results...)
		if groupHasErrors {
			hasErrors = true
		}
	}

	printSummary(allResults, "")
	return evalRunCompletionError(allResults, hasErrors)
}

func runEvalGroup(group runGroup, opts evalRunOpts) ([]evalResult, bool, error) {
	startedAt := time.Now()
	// Create temp working directory for Harbor
	workDir, err := os.MkdirTemp("", "moltnet-eval-*")
	if err != nil {
		return nil, false, fmt.Errorf("creating temp dir: %w", err)
	}
	defer func() {
		fmt.Fprintf(os.Stderr, "Artifacts preserved at: %s\n", workDir)
	}()

	tasksDir := filepath.Join(workDir, "tasks")
	if err := os.MkdirAll(tasksDir, 0o755); err != nil {
		return nil, false, fmt.Errorf("creating tasks dir: %w", err)
	}

	// Write Python agent to temp dir
	agentsDir, err := setupAgentsDir(workDir)
	if err != nil {
		return nil, false, fmt.Errorf("setting up agents: %w", err)
	}

	// Deduplicate names (batch configs may have same basename)
	seen := make(map[string]int)
	for i := range group.inputs {
		seen[group.inputs[i].name]++
		if seen[group.inputs[i].name] > 1 {
			group.inputs[i].name = fmt.Sprintf("%s-%d", group.inputs[i].name, seen[group.inputs[i].name])
		}
	}

	tmplData := templateData{
		JudgeSDK:          opts.judge,
		JudgeModelDefault: opts.judgeModel,
	}
	for _, input := range group.inputs {
		// Always scaffold without-context variant
		dir := filepath.Join(tasksDir, input.name)
		if err := scaffoldTask(dir, input.taskMD, input.criteriaJSON, "", false, tmplData, input.agent); err != nil {
			return nil, false, fmt.Errorf("scaffolding %s: %w", input.name, err)
		}

		// If pack provided, also scaffold with-context variant
		if input.packMD != "" {
			ctxDir := filepath.Join(tasksDir, input.name+"-with-context")
			if err := scaffoldTask(ctxDir, input.taskMD, input.criteriaJSON, input.packMD, true, tmplData, input.agent); err != nil {
				return nil, false, fmt.Errorf("scaffolding %s-with-context: %w", input.name, err)
			}
		}
	}

	fmt.Fprintf(os.Stderr, "Running %d eval task(s) with agent=%s model=%s...\n", len(group.inputs), group.agent, group.model)
	if err := runHarbor(workDir, tasksDir, agentsDir, group.model, group.agent, opts.judgeModel, opts.concurrency, opts.forceBuild); err != nil {
		fmt.Fprintf(os.Stderr, "warning: harbor exited with error (some trials may have failed): %v\n", err)
	}

	// Extract and display results
	jobDir, err := findJobDir(workDir)
	if err != nil {
		return nil, false, fmt.Errorf("finding job results: %w", err)
	}

	results, err := extractResults(jobDir)
	if err != nil {
		return nil, false, fmt.Errorf("extracting results: %w", err)
	}

	// Write job_result.json for canary comparison parity with DSPy engine.
	if err := writeJobResultSummary(jobDir, "harbor", startedAt, results, opts); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not write harbor job_result.json: %v\n", err)
	}

	printRunPaths(jobDir)

	if len(results) == 0 {
		return nil, false, fmt.Errorf("no results found — all trials may have failed")
	}

	// Check if any trial had errors
	hasErrors := false
	for _, r := range results {
		if (r.withoutContext != nil && r.withoutContext.err != "") ||
			(r.withContext != nil && r.withContext.err != "") {
			hasErrors = true
			break
		}
	}
	return results, hasErrors, nil
}
