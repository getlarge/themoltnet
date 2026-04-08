package main

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/solver"
	"gopkg.in/yaml.v2"
)

// evalRunOpts holds flags shared by single-task and config modes.
type evalRunOpts struct {
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
	dspyMode         string          // "vitro" | "vivo" | "" (legacy)
	dspyFixtureRef   string          // --fixture-ref CLI override
}

// validateEvalEngine accepts only the dspy engine (or empty for default).
// Kept as a small helper so the cobra layer + tests can exercise the
// allowlist without reaching into runtime dispatch.
func validateEvalEngine(engine string) error {
	switch engine {
	case "", "dspy":
		return nil
	default:
		return fmt.Errorf("unknown engine %q (must be dspy)", engine)
	}
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
	if engine != "" && engine != "dspy" {
		return fmt.Errorf("unsupported engine %q", engine)
	}
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
	if err := checkPrerequisites("dspy", opts); err != nil {
		return err
	}
	input, err := resolveEvalRun(taskDir, packPath, opts.agent, opts.model)
	if err != nil {
		return err
	}
	return runDSPYEvalSingleTask(input, opts)
}

func runEvalFromConfig(configPath string, opts evalRunOpts) error {
	if err := checkPrerequisites("dspy", opts); err != nil {
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
	return runDSPYEvalBatch(inputs, opts)
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
