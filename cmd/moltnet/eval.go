package main

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v2"
)

// evalRunOpts holds flags shared by single-task and config modes.
type evalRunOpts struct {
	model       string
	concurrency int
	forceBuild  bool
	agent       string // "claude" | "codex"
	judge       string // "claude" | "codex"
	judgeModel  string // judge model (prefix-free)
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
	Scenario string `yaml:"scenario"`
	Pack     string `yaml:"pack,omitempty"`
	Agent    string `yaml:"agent,omitempty"`
	Model    string `yaml:"model,omitempty"`
}

// evalRunInput is the resolved input for a single eval run.
type evalRunInput struct {
	name         string
	taskMD       []byte
	criteriaJSON []byte
	packMD       string
	agent        string
	model        string
}

// evalConfig is the YAML config file schema.
type evalConfig struct {
	Runs []evalRun `yaml:"runs"`
}

// --- Prerequisites ---

func checkPrerequisites() error {
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

	// Show log paths for failed trials
	for _, s := range []*trialScores{r.withoutContext, r.withContext} {
		if s != nil && s.err != "" && s.name != "" {
			fmt.Printf("\n  Logs: %s/\n", s.name)
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
	if err := validateTaskDir(scenarioDir); err != nil {
		return evalRunInput{}, err
	}
	taskMD, err := os.ReadFile(filepath.Join(scenarioDir, "task.md"))
	if err != nil {
		return evalRunInput{}, fmt.Errorf("reading task.md from %s: %w", scenarioDir, err)
	}
	criteriaJSON, err := os.ReadFile(filepath.Join(scenarioDir, "criteria.json"))
	if err != nil {
		return evalRunInput{}, fmt.Errorf("reading criteria.json from %s: %w", scenarioDir, err)
	}
	var packMD string
	if packPath != "" {
		data, err := os.ReadFile(packPath)
		if err != nil {
			return evalRunInput{}, fmt.Errorf("reading pack %s: %w", packPath, err)
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
	}, nil
}

func runEvalSingleTask(taskDir, packPath string, opts evalRunOpts) error {
	if err := checkPrerequisites(); err != nil {
		return err
	}
	input, err := resolveEvalRun(taskDir, packPath, opts.agent, opts.model)
	if err != nil {
		return err
	}
	return runEval([]evalRunInput{input}, opts)
}

func runEvalFromConfig(configPath string, opts evalRunOpts) error {
	if err := checkPrerequisites(); err != nil {
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
	return runEval(inputs, opts)
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
	// Create temp working directory for Harbor
	workDir, err := os.MkdirTemp("", "moltnet-eval-*")
	if err != nil {
		return nil, false, fmt.Errorf("creating temp dir: %w", err)
	}
	hasErrors := true // assume errors; set false on clean exit
	defer func() {
		if hasErrors {
			fmt.Fprintf(os.Stderr, "Artifacts preserved at: %s\n", workDir)
		} else {
			os.RemoveAll(workDir)
		}
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

	if len(results) == 0 {
		return nil, false, fmt.Errorf("no results found — all trials may have failed")
	}

	// Check if any trial had errors
	hasErrors = false
	for _, r := range results {
		if (r.withoutContext != nil && r.withoutContext.err != "") ||
			(r.withContext != nil && r.withContext.err != "") {
			hasErrors = true
			break
		}
	}
	return results, hasErrors, nil
}
