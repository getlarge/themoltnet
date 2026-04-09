package main

import (
	"fmt"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/solver"
	"github.com/spf13/cobra"
)

func newEvalCmd() *cobra.Command {
	evalCmd := &cobra.Command{
		Use:   "eval",
		Short: "Eval runner commands",
	}
	evalCmd.AddCommand(newEvalRunCmd())
	return evalCmd
}

func newEvalRunCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "run",
		Short: "Run evals with optional context pack injection",
		Long: `Run evals against local task definitions. Supports single-task
	mode (--scenario) or batch mode (--config) with per-task pack assignment.

When --pack is provided, runs both with-context and without-context
variants and reports the score delta (pack contribution).

When --pack is provided with --concurrency >= 2, without-context
and with-context variants run in parallel.

Isolation modes (--mode / eval.json):
  vitro  sparse worktree. Task instructions are delivered via the prompt;
         the filesystem starts empty. Scenarios declare on-disk fixtures
         via eval.json "fixture.include" (repo-relative globs). Default
         is an empty filesystem.
  vivo   real repo checked out at fixture.ref (required). The agent sees
         the repo as it existed at that commit, minus --worktree-exclude
         globs.

Isolation tradeoff: vitro preserves the .git entry (file or directory)
so worktree cleanup works. This means an agent can use git plumbing
(git show, cat-file, log) to read blobs that were removed from the
working tree. Vitro is a "sparse filesystem view", NOT a cryptographic
air gap — do not rely on it to hide content from git-aware tooling.
Full isolation (git archive into a plain tempdir) is tracked as a
follow-up.`,
		Example: `  # Single task, baseline only
  moltnet eval run --scenario ./evals/codegen-chain

  # Single task with rendered pack context
  moltnet eval run --scenario ./evals/codegen-chain --pack ./packs/practices.md

  # Batch run from config file with concurrency
  moltnet eval run --config eval.yaml --concurrency 3

  # With model override and force rebuild
  moltnet eval run --scenario ./evals/codegen-chain --pack ./pack.md -m anthropic/claude-sonnet-4-6 -f

  # Run with codex agent and codex judge
  moltnet eval run --scenario ./evals/codegen-chain --agent codex --judge codex

  # Run with codex agent but claude judge, explicit model
  moltnet eval run --scenario ./evals/codegen-chain --agent codex -m openai/gpt-5-codex --judge claude`,
		RunE: func(cmd *cobra.Command, args []string) error {
			task, _ := cmd.Flags().GetString("scenario")
			pack, _ := cmd.Flags().GetString("pack")
			config, _ := cmd.Flags().GetString("config")
			model, _ := cmd.Flags().GetString("model")
			concurrency, _ := cmd.Flags().GetInt("concurrency")
			agent, _ := cmd.Flags().GetString("agent")
			judge, _ := cmd.Flags().GetString("judge")
			judgeModel, _ := cmd.Flags().GetString("judge-model")
			worktreeExcludes, _ := cmd.Flags().GetStringSlice("worktree-exclude")
			solverFlag, _ := cmd.Flags().GetString("solver")
			mode, _ := cmd.Flags().GetString("mode")
			fixtureRef, _ := cmd.Flags().GetString("fixture-ref")

			solverChanged := cmd.Flags().Changed("solver")

			if mode != "" && mode != "vitro" && mode != "vivo" {
				return fmt.Errorf("--mode must be vitro or vivo, got %q", mode)
			}
			if fixtureRef != "" && mode != "" && mode != "vivo" {
				return fmt.Errorf("--fixture-ref requires --mode vivo")
			}

			if concurrency < 1 {
				return fmt.Errorf("--concurrency must be at least 1")
			}
			if task == "" && config == "" {
				return fmt.Errorf("either --scenario or --config is required")
			}
			if task != "" && config != "" {
				return fmt.Errorf("--scenario and --config are mutually exclusive")
			}
			if pack != "" && config != "" {
				return fmt.Errorf("--pack is only valid with --scenario, not --config")
			}

			if !cmd.Flags().Changed("model") {
				model = defaultAgentModel(agent)
			}
			if judgeModel == "" {
				judgeModel = defaultJudgeModel(judge)
			}

			if err := validateAgentModel(agent, model); err != nil {
				return err
			}
			if err := validateJudgeModel(judge, judgeModel); err != nil {
				return err
			}

			// Only set opts.solverKind when the user explicitly chose a
			// solver (via --solver). Empty means "fall back
			// to manifest, then built-in default" — resolved by
			// dspyEvalSolver at the runSolver call site.
			var solverKind solver.Kind
			if solverChanged {
				k, err := solver.ParseKind(solverFlag)
				if err != nil {
					return err
				}
				solverKind = k
			}

			opts := evalRunOpts{
				model:            model,
				concurrency:      concurrency,
				agent:            agent,
				judge:            judge,
				judgeModel:       judgeModel,
				worktreeExcludes: worktreeExcludes,
				solverKind:       solverKind,
				dspyMode:         mode,
				dspyFixtureRef:   fixtureRef,
			}

			if config != "" {
				return runEvalFromConfig(config, opts)
			}
			return runEvalSingleTask(task, pack, opts)
		},
	}
	cmd.Flags().StringP("scenario", "s", "", "Path to eval scenario directory (contains task.md + criteria.json)")
	cmd.Flags().StringP("pack", "p", "", "Path to rendered pack markdown to inject as context")
	cmd.Flags().StringP("config", "c", "", "Path to YAML or JSON config file for batch runs")
	cmd.Flags().StringP("model", "m", "", "Model for the agent (default depends on --agent)")
	cmd.Flags().Int("concurrency", 1, "Number of concurrent trials")
	cmd.Flags().String("agent", "claude", "Agent to use: claude or codex")
	cmd.Flags().String("judge", "claude", "Judge SDK to use: claude or codex")
	cmd.Flags().String("judge-model", "", "Model for the judge (default depends on --judge)")
	cmd.Flags().StringSlice("worktree-exclude", nil, "Glob patterns for worktree-relative paths to remove from the eval worktree before task execution")
	// TODO(#714): drop "— not yet implemented" once the ReAct tool registry lands.
	cmd.Flags().String("solver", "", "Solver module override: cot (ChainOfThought) or react (ReAct — not yet implemented). Overrides eval.json solver. Default: cot (via eval.json or built-in fallback).")
	cmd.Flags().String("mode", "", "Isolation mode override: vitro (sparse, task inputs only) or vivo (real repo at fixture-ref). Overrides eval.json mode.")
	cmd.Flags().String("fixture-ref", "", "Git commit ref for vivo mode. Overrides eval.json fixture.ref.")
	return cmd
}
