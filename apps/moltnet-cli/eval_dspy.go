package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
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
)

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
				return fmt.Errorf("scenario %q: --agent must be claude or codex, got %q", in.name, in.agent)
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
		return fmt.Errorf("--agent must be claude or codex, got %q", opts.agent)
	}
	switch opts.judge {
	case "claude", "codex":
	default:
		return fmt.Errorf("--judge must be claude or codex, got %q", opts.judge)
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

	worktreeDir, cleanupWorktree, err := createDSPYEvalWorktree(variantDir, variantName, opts, input.manifest, input.scenarioDir)
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

	solverKind, err := dspyEvalSolver(input.manifest, opts)
	if err != nil {
		return nil, fmt.Errorf("resolve solver kind: %w", err)
	}
	effectiveMode := dspyEvalMode(input.manifest, opts)
	agentResult, err := runSolver(solverInput{
		workDir:     worktreeDir,
		agent:       agentName,
		model:       model,
		taskMD:      string(input.taskMD),
		packMD:      input.packMD,
		withContext: withContext,
		kind:        solverKind,
		mode:        effectiveMode,
		fixtureRef:  opts.dspySourceRef,
		tb:          tb,
	})
	if err != nil {
		return nil, err
	}

	filesSnapshot, err := buildWorkspaceSnapshot(worktreeDir, agentResult.output, effectiveMode)
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

// writeDSPYEvalPackToDisk writes the context pack to disk in the worktree so
// both the agent and the judge can observe what context was provided.
//
// Three files are written:
//   - context-pack.md — canonical pack content; picked up by the workspace
//     snapshot so the judge sees exactly what was provided to the agent.
//   - .claude/CLAUDE.md — @-imports context-pack.md so Claude Code loads it as
//     project context automatically.
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
	// Claude Code supports @file imports; write under .claude/ so it picks
	// up the pack via its standard project-context discovery.
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
	mode        string      // "vitro" or "vivo" — selects signature
	fixtureRef  string      // resolved fixture.ref commit hash (vivo only)
	tb          *trialBar
}

// buildSolverInputs constructs the named input map for module.Process.
// Vivo mode adds repo_ref (must be non-empty); baseline variants get an
// empty context_pack.
func buildSolverInputs(in solverInput) (map[string]any, error) {
	contextPack := ""
	if in.withContext && strings.TrimSpace(in.packMD) != "" {
		contextPack = in.packMD
	}
	inputs := map[string]any{
		"task_markdown": in.taskMD,
		"context_pack":  contextPack,
	}
	if in.mode == "vivo" {
		if in.fixtureRef == "" {
			return nil, fmt.Errorf("vivo mode requires fixture.ref; pass --fixture-ref or set fixture.ref in eval.json")
		}
		inputs["repo_ref"] = in.fixtureRef
	}
	return inputs, nil
}

// dspyEvalSignature selects the dspy-go signature based on eval mode.
// Vivo gets the VivoSignature (extra repo_ref input, tool_trace output);
// vitro (or empty, the default) gets VitroSignature. Unknown modes error.
func dspyEvalSignature(mode string) (core.Signature, error) {
	switch mode {
	case "vivo":
		return solver.VivoSignature(), nil
	case "vitro", "":
		return solver.VitroSignature(), nil
	default:
		return core.Signature{}, fmt.Errorf("unknown eval mode %q: must be vitro or vivo", mode)
	}
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

	sig, err := dspyEvalSignature(in.mode)
	if err != nil {
		return nil, err
	}

	module, err := solver.New(solver.Config{
		Kind:      kind,
		Signature: sig,
		LLM:       llm,
	})
	if err != nil {
		return nil, fmt.Errorf("init solver module: %w", err)
	}

	inputs, err := buildSolverInputs(in)
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	// TODO(#714): capture module.Process outputs (reasoning,
	// workspace_summary) for GEPA once the optimizer lands. Today the
	// judge reads the filesystem via buildWorkspaceSnapshot as ground truth;
	// these outputs are narrative-only and deliberately discarded.
	_, procErr := module.Process(ctx, inputs)

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

func buildWorkspaceSnapshot(workDir, fallbackOutput, mode string) (string, error) {
	switch mode {
	case "vivo":
		return buildVivoWorkspaceSnapshot(workDir, fallbackOutput)
	case "vitro", "":
		return buildVitroWorkspaceSnapshot(workDir, fallbackOutput)
	default:
		return "", fmt.Errorf("unknown eval mode %q for workspace snapshot", mode)
	}
}

// buildVitroWorkspaceSnapshot reads full file contents of changed files.
// Safe for vitro worktrees which contain only injected fixture files.
func buildVitroWorkspaceSnapshot(workDir, fallbackOutput string) (string, error) {
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

// buildVivoWorkspaceSnapshot produces a lightweight summary suitable for the
// judge when the worktree is a full repo checkout. Instead of reading every
// changed file (which can overflow the judge's context window), it captures:
//   - git status --short (what changed)
//   - git diff --stat    (change magnitudes)
//   - git diff for small files only (notes.md and files under vivoSnapshotDiffCap bytes)
//
// The judge gets enough signal to evaluate criteria without a multi-megabyte
// text dump.
func buildVivoWorkspaceSnapshot(workDir, fallbackOutput string) (string, error) {
	var b strings.Builder
	hasEvidence := false

	statusOut, statusErr := gitOutput(workDir, "status", "--short")
	if statusErr != nil {
		b.WriteString("## git status\n```\n(unavailable)\n```\n\n")
	} else {
		b.WriteString("## git status\n```\n")
		b.WriteString(strings.TrimSpace(statusOut))
		b.WriteString("\n```\n\n")
		hasEvidence = strings.TrimSpace(statusOut) != ""
	}

	diffStatOut, diffErr := gitOutput(workDir, "diff", "--stat")
	if diffErr != nil {
		b.WriteString("## git diff --stat\n```\n(unavailable)\n```\n\n")
	} else {
		b.WriteString("## git diff --stat\n```\n")
		b.WriteString(strings.TrimSpace(diffStatOut))
		b.WriteString("\n```\n\n")
	}

	// Include full content for small changed files. Only parse paths when
	// git status succeeded — never parse a placeholder error string.
	if statusErr == nil {
		paths := parseGitStatusPaths(statusOut)
		sort.Strings(paths)
		var skipped []string
		for _, rel := range paths {
			if vivoSnapshotDenyPath(rel) {
				continue
			}
			fullPath := filepath.Join(workDir, rel)
			info, statErr := os.Stat(fullPath)
			if statErr != nil || info.IsDir() {
				continue
			}
			if info.Size() > vivoSnapshotDiffCap {
				continue
			}
			data, readErr := os.ReadFile(fullPath)
			if readErr != nil {
				skipped = append(skipped, fmt.Sprintf("%s: %v", rel, readErr))
				continue
			}
			b.WriteString("## ")
			b.WriteString(rel)
			b.WriteString("\n")
			b.WriteString(string(data))
			b.WriteString("\n\n")
			hasEvidence = true
		}
		if len(skipped) > 0 {
			b.WriteString("<!-- skipped files:\n")
			for _, s := range skipped {
				b.WriteString("  - ")
				b.WriteString(s)
				b.WriteString("\n")
			}
			b.WriteString("-->\n\n")
		}
	}

	if !hasEvidence && strings.TrimSpace(fallbackOutput) != "" {
		b.WriteString("## final-response.txt\n")
		b.WriteString(fallbackOutput)
		b.WriteString("\n")
	}
	return b.String(), nil
}

// vivoSnapshotDenyPath returns true for paths that must never be inlined
// in a vivo snapshot (secrets, credentials, env files).
func vivoSnapshotDenyPath(rel string) bool {
	base := filepath.Base(rel)
	if strings.HasPrefix(base, ".env") {
		return true
	}
	switch base {
	case "moltnet.json", "credentials.json", "id_ed25519", "id_ed25519.pub":
		return true
	}
	return false
}

// vivoSnapshotDiffCap is the max file size (bytes) to include inline in a vivo
// snapshot. Files larger than this are represented only in git status/diff --stat.
const vivoSnapshotDiffCap = 8192

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
