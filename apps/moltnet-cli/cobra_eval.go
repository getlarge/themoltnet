package main

import (
	"fmt"

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

Use --engine harbor for the current containerized path.
Use --engine dspy for the lightweight Claude-only path.
When --pack is provided with --concurrency >= 2, without-context
and with-context variants run in parallel.`,
		Example: `  # Single task, baseline only
  moltnet eval run --scenario ./evals/codegen-chain

  # Single task with rendered pack context
  moltnet eval run --scenario ./evals/codegen-chain --pack ./packs/practices.md

  # Single task with lightweight DSPy engine
  moltnet eval run --engine dspy --scenario ./evals/codegen-chain

  # Batch run from config file (works with both engines)
  moltnet eval run --config eval.yaml --concurrency 2

  # DSPy batch run with concurrency
  moltnet eval run --engine dspy --config eval.yaml --concurrency 3

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
			forceBuild, _ := cmd.Flags().GetBool("force-build")
			engine, _ := cmd.Flags().GetString("engine")
			agent, _ := cmd.Flags().GetString("agent")
			judge, _ := cmd.Flags().GetString("judge")
			judgeModel, _ := cmd.Flags().GetString("judge-model")
			worktreeExcludes, _ := cmd.Flags().GetStringSlice("worktree-exclude")

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
			if err := validateEvalEngine(engine); err != nil {
				return err
			}

			opts := evalRunOpts{
				engine:           engine,
				model:            model,
				concurrency:      concurrency,
				forceBuild:       forceBuild,
				agent:            agent,
				judge:            judge,
				judgeModel:       judgeModel,
				worktreeExcludes: worktreeExcludes,
			}

			if config != "" {
				return runEvalFromConfig(config, opts)
			}
			return runEvalSingleTask(task, pack, opts)
		},
	}
	cmd.Flags().StringP("scenario", "s", "", "Path to eval scenario directory (contains task.md + criteria.json)")
	cmd.Flags().StringP("pack", "p", "", "Path to rendered pack markdown to inject as context")
	cmd.Flags().StringP("config", "c", "", "Path to YAML config file for batch runs")
	cmd.Flags().StringP("model", "m", "", "Model for the agent (default depends on --agent)")
	cmd.Flags().Int("concurrency", 1, "Number of concurrent trials")
	cmd.Flags().BoolP("force-build", "f", false, "Force Docker image rebuild")
	cmd.Flags().String("engine", "harbor", "Execution engine: harbor or dspy")
	cmd.Flags().String("agent", "claude", "Agent to use: claude or codex")
	cmd.Flags().String("judge", "claude", "Judge SDK to use: claude or codex")
	cmd.Flags().String("judge-model", "", "Model for the judge (default depends on --judge)")
	cmd.Flags().StringSlice("worktree-exclude", nil, "Glob patterns for worktree-relative paths to remove before --engine dspy task execution")
	return cmd
}
