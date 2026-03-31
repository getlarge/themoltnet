package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v2"
)

// evalRunOpts holds flags shared by single-task and config modes.
type evalRunOpts struct {
	model       string
	concurrency int
	forceBuild  bool
}

// evalRun describes one task + optional pack pair (used in config mode).
type evalRun struct {
	Task string `yaml:"task"`
	Pack string `yaml:"pack,omitempty"`
}

// evalConfig is the YAML config file schema.
type evalConfig struct {
	Runs []evalRun `yaml:"runs"`
}

// trialScores holds parsed scores for a single trial.
type trialScores struct {
	name    string
	reward  float64
	details map[string]float64
	err     string // non-empty if the trial failed
}

// evalResult holds the outcome for one eval task.
type evalResult struct {
	taskName     string
	withContext   *trialScores
	withoutContext *trialScores
}

// --- Prerequisites ---

func checkPrerequisites() error {
	if _, err := exec.LookPath("harbor"); err != nil {
		return fmt.Errorf("harbor CLI not found on PATH — install with: uv tool install harbor")
	}
	if err := exec.Command("docker", "info").Run(); err != nil {
		return fmt.Errorf("docker is not running or not accessible")
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
		if !filepath.IsAbs(r.Task) {
			r.Task = filepath.Join(configDir, r.Task)
		}
		if r.Pack != "" && !filepath.IsAbs(r.Pack) {
			r.Pack = filepath.Join(configDir, r.Pack)
		}
		if err := validateTaskDir(r.Task); err != nil {
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

func scaffoldTask(dir string, taskMD, criteriaJSON []byte, packMD string, withContext bool) error {
	dirs := []string{
		filepath.Join(dir, "environment", "judge"),
		filepath.Join(dir, "tests"),
	}
	if withContext {
		dirs = append(dirs, filepath.Join(dir, "environment", ".claude"))
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", d, err)
		}
	}

	files := map[string][]byte{
		filepath.Join(dir, "task.toml"):                          taskTomlTemplate,
		filepath.Join(dir, "instruction.md"):                     taskMD,
		filepath.Join(dir, "environment", "Dockerfile"):          dockerfileTemplate,
		filepath.Join(dir, "environment", "judge", "judge.js"):   judgeJS,
		filepath.Join(dir, "environment", "judge", "package.json"): judgePackageJSON,
		filepath.Join(dir, "tests", "criteria.json"):             criteriaJSON,
	}
	for path, content := range files {
		if err := os.WriteFile(path, content, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", path, err)
		}
	}

	// test.sh needs execute permission
	if err := os.WriteFile(filepath.Join(dir, "tests", "test.sh"), testShTemplate, 0o755); err != nil {
		return fmt.Errorf("write test.sh: %w", err)
	}

	if withContext {
		claudeMD := fmt.Sprintf("# Context Pack\n\n%s", packMD)
		path := filepath.Join(dir, "environment", ".claude", "CLAUDE.md")
		if err := os.WriteFile(path, []byte(claudeMD), 0o644); err != nil {
			return fmt.Errorf("write CLAUDE.md: %w", err)
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
	return baseDir, nil
}

func runHarbor(workDir, tasksDir, agentsDir, model string, concurrency int, forceBuild bool) error {
	args := []string{
		"run",
		"-p", tasksDir,
		"--agent-import-path", "agents.claude_code_moltnet:ClaudeCodeMoltNet",
		"--model", model,
		"--n-concurrent", strconv.Itoa(concurrency),
		"-y",
	}
	if forceBuild {
		args = append(args, "--force-build")
	}

	cmd := exec.Command("harbor", args...)
	cmd.Dir = workDir // Harbor writes jobs/ relative to CWD
	cmd.Env = append(os.Environ(), "PYTHONPATH="+agentsDir)
	cmd.Stdout = os.Stderr // Harbor progress + results to stderr
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// --- Result extraction ---

// harborResult mirrors Harbor's result.json structure (partial).
type harborResult struct {
	Stats struct {
		NErrors int `json:"n_errors"`
		Evals   map[string]struct {
			RewardStats struct {
				Reward map[string][]string `json:"reward"`
			} `json:"reward_stats"`
		} `json:"evals"`
	} `json:"stats"`
}

func findJobDir(workDir string) (string, error) {
	jobsDir := filepath.Join(workDir, "jobs")
	entries, err := os.ReadDir(jobsDir)
	if err != nil {
		return "", fmt.Errorf("reading jobs dir: %w", err)
	}
	// Pick the most recent (last sorted) job directory
	var latest string
	for _, e := range entries {
		if e.IsDir() {
			latest = e.Name()
		}
	}
	if latest == "" {
		return "", fmt.Errorf("no job directories found in %s", jobsDir)
	}
	return filepath.Join(jobsDir, latest), nil
}

func extractResults(jobDir string) ([]evalResult, error) {
	entries, err := os.ReadDir(jobDir)
	if err != nil {
		return nil, fmt.Errorf("reading job dir: %w", err)
	}

	// Group trials by base task name
	type trialInfo struct {
		dir         string
		withContext bool
	}
	groups := make(map[string][]trialInfo)

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// Harbor trial dirs look like: task-name__randomID
		parts := strings.SplitN(name, "__", 2)
		if len(parts) != 2 {
			continue
		}
		trialName := parts[0]

		// Determine if this is a with-context variant
		isContext := strings.HasSuffix(trialName, "-with-conte") ||
			strings.HasSuffix(trialName, "-with-context")

		baseName := trialName
		if isContext {
			// Strip the -with-conte(xt) suffix to get the base task name
			baseName = strings.TrimSuffix(baseName, "-with-conte")
			baseName = strings.TrimSuffix(baseName, "-with-context")
		}

		groups[baseName] = append(groups[baseName], trialInfo{
			dir:         filepath.Join(jobDir, name),
			withContext: isContext,
		})
	}

	var results []evalResult
	for baseName, trials := range groups {
		result := evalResult{taskName: baseName}
		for _, t := range trials {
			scores, err := readTrialScores(t.dir)
			if err != nil {
				fmt.Fprintf(os.Stderr, "warning: could not read scores for %s: %v\n", filepath.Base(t.dir), err)
				continue
			}
			scores.name = filepath.Base(t.dir)
			if t.withContext {
				result.withContext = scores
			} else {
				result.withoutContext = scores
			}
		}
		results = append(results, result)
	}
	return results, nil
}

func readTrialScores(trialDir string) (*trialScores, error) {
	scores := &trialScores{}

	// Check for trial-level errors first
	resultPath := filepath.Join(trialDir, "result.json")
	if data, err := os.ReadFile(resultPath); err == nil {
		var result struct {
			ExceptionInfo *struct {
				Type    string `json:"exception_type"`
				Message string `json:"exception_message"`
			} `json:"exception_info"`
		}
		if err := json.Unmarshal(data, &result); err == nil && result.ExceptionInfo != nil {
			scores.err = result.ExceptionInfo.Type
			// Try to extract a short reason from the message
			if msg := result.ExceptionInfo.Message; len(msg) > 0 {
				// Look for common patterns
				if strings.Contains(msg, "Not logged in") {
					scores.err += ": OAuth token expired — re-authenticate and retry"
				} else if strings.Contains(msg, "ECONNRESET") || strings.Contains(msg, "TLS connect error") {
					scores.err += ": TLS connection failed — check Docker networking"
				} else if strings.Contains(msg, "timed out") {
					scores.err += ": agent timed out"
				}
			}
		}
	}

	// Try to read reward even if there was an error (judge may have run)
	rewardPath := filepath.Join(trialDir, "verifier", "reward.json")
	rewardData, err := os.ReadFile(rewardPath)
	if err != nil {
		if scores.err != "" {
			// No reward but we have error context — return what we have
			return scores, nil
		}
		return nil, fmt.Errorf("reading reward.json: %w", err)
	}

	var reward struct {
		Reward float64 `json:"reward"`
	}
	if err := json.Unmarshal(rewardData, &reward); err != nil {
		return nil, fmt.Errorf("parsing reward.json: %w", err)
	}
	scores.reward = reward.Reward

	// scores.json is optional
	scoresPath := filepath.Join(trialDir, "verifier", "scores.json")
	if data, err := os.ReadFile(scoresPath); err == nil {
		var details map[string]float64
		if err := json.Unmarshal(data, &details); err == nil {
			scores.details = details
		}
	}

	return scores, nil
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
	if s.err != "" {
		fmt.Printf("  %-18s  FAILED — %s\n", label+":", s.err)
	} else {
		fmt.Printf("  %-18s  %.2f  (%.1f%%)\n", label+":", s.reward, s.reward*100)
	}
}

func printSingleSummary(r evalResult, model string) {
	fmt.Printf("Eval: %s\n", r.taskName)
	fmt.Printf("Model: %s\n\n", model)

	printVariantLine("Without context", r.withoutContext)
	printVariantLine("With context", r.withContext)

	if r.withoutContext != nil && r.withContext != nil &&
		r.withoutContext.err == "" && r.withContext.err == "" {
		delta := r.withContext.reward - r.withoutContext.reward
		fmt.Printf("  Delta:              %+.2f  (%+.1f%%)\n", delta, delta*100)
	}

	// Print per-criterion details for the best variant
	best := r.withContext
	if best == nil || best.err != "" {
		best = r.withoutContext
	}
	if best != nil && best.err == "" && len(best.details) > 0 {
		label := "with context"
		if r.withContext == nil || r.withContext.err != "" {
			label = "without context"
		}
		fmt.Printf("\n  Criteria (%s):\n", label)
		for name, score := range best.details {
			fmt.Printf("    %.0f%%  %s\n", score*100, name)
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
	fmt.Printf("Model: %s\n\n", model)
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

func runEvalSingleTask(taskDir, packPath string, opts evalRunOpts) error {
	if err := checkPrerequisites(); err != nil {
		return err
	}
	if err := validateTaskDir(taskDir); err != nil {
		return err
	}

	taskMD, err := os.ReadFile(filepath.Join(taskDir, "task.md"))
	if err != nil {
		return fmt.Errorf("reading task.md: %w", err)
	}
	criteriaJSON, err := os.ReadFile(filepath.Join(taskDir, "criteria.json"))
	if err != nil {
		return fmt.Errorf("reading criteria.json: %w", err)
	}

	var packMD string
	if packPath != "" {
		data, err := os.ReadFile(packPath)
		if err != nil {
			return fmt.Errorf("reading pack: %w", err)
		}
		packMD = string(data)
	}

	taskName := filepath.Base(taskDir)

	return runEval([]evalRun{{Task: taskDir}}, []string{taskName}, [][]byte{taskMD}, [][]byte{criteriaJSON}, []string{packMD}, opts)
}

func runEvalFromConfig(configPath string, opts evalRunOpts) error {
	if err := checkPrerequisites(); err != nil {
		return err
	}

	runs, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	var taskNames []string
	var taskMDs, criteriaJSONs [][]byte
	var packMDs []string

	for _, r := range runs {
		taskMD, err := os.ReadFile(filepath.Join(r.Task, "task.md"))
		if err != nil {
			return fmt.Errorf("reading task.md from %s: %w", r.Task, err)
		}
		criteria, err := os.ReadFile(filepath.Join(r.Task, "criteria.json"))
		if err != nil {
			return fmt.Errorf("reading criteria.json from %s: %w", r.Task, err)
		}

		var packMD string
		if r.Pack != "" {
			data, err := os.ReadFile(r.Pack)
			if err != nil {
				return fmt.Errorf("reading pack %s: %w", r.Pack, err)
			}
			packMD = string(data)
		}

		taskNames = append(taskNames, filepath.Base(r.Task))
		taskMDs = append(taskMDs, taskMD)
		criteriaJSONs = append(criteriaJSONs, criteria)
		packMDs = append(packMDs, packMD)
	}

	return runEval(runs, taskNames, taskMDs, criteriaJSONs, packMDs, opts)
}

func runEval(runs []evalRun, taskNames []string, taskMDs, criteriaJSONs [][]byte, packMDs []string, opts evalRunOpts) error {
	// Create temp working directory for Harbor
	workDir, err := os.MkdirTemp("", "moltnet-eval-*")
	if err != nil {
		return fmt.Errorf("creating temp dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	tasksDir := filepath.Join(workDir, "tasks")
	if err := os.MkdirAll(tasksDir, 0o755); err != nil {
		return fmt.Errorf("creating tasks dir: %w", err)
	}

	// Write Python agent to temp dir
	agentsDir, err := setupAgentsDir(workDir)
	if err != nil {
		return fmt.Errorf("setting up agents: %w", err)
	}

	// Scaffold task variants
	for i, name := range taskNames {
		// Always scaffold without-context variant
		dir := filepath.Join(tasksDir, name)
		if err := scaffoldTask(dir, taskMDs[i], criteriaJSONs[i], "", false); err != nil {
			return fmt.Errorf("scaffolding %s: %w", name, err)
		}

		// If pack provided, also scaffold with-context variant
		if packMDs[i] != "" {
			ctxDir := filepath.Join(tasksDir, name+"-with-context")
			if err := scaffoldTask(ctxDir, taskMDs[i], criteriaJSONs[i], packMDs[i], true); err != nil {
				return fmt.Errorf("scaffolding %s-with-context: %w", name, err)
			}
		}
	}

	// Run Harbor
	fmt.Fprintf(os.Stderr, "Running %d eval task(s) with model %s...\n", len(taskNames), opts.model)
	if err := runHarbor(workDir, tasksDir, agentsDir, opts.model, opts.concurrency, opts.forceBuild); err != nil {
		fmt.Fprintf(os.Stderr, "warning: harbor exited with error (some trials may have failed): %v\n", err)
	}

	// Extract and display results
	jobDir, err := findJobDir(workDir)
	if err != nil {
		return fmt.Errorf("finding job results: %w", err)
	}

	results, err := extractResults(jobDir)
	if err != nil {
		return fmt.Errorf("extracting results: %w", err)
	}

	if len(results) == 0 {
		return fmt.Errorf("no results found — all trials may have failed")
	}

	printSummary(results, opts.model)
	return nil
}
