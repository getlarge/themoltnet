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
		Short: "Run Harbor evals with optional context pack injection",
		Long: `Run Harbor evals against local task definitions. Supports single-task
mode (--scenario) or batch mode (--config) with per-task pack assignment.

When --pack is provided, runs both with-context and without-context
variants and reports the score delta (pack contribution).`,
		Example: `  # Single task, baseline only
  moltnet eval run --scenario ./evals/codegen-chain

  # Single task with rendered pack context
  moltnet eval run --scenario ./evals/codegen-chain --pack ./packs/practices.md

  # Batch run from config file
  moltnet eval run --config eval.yaml --concurrency 2

  # With model override and force rebuild
  moltnet eval run --scenario ./evals/codegen-chain --pack ./pack.md -m claude-sonnet-4-6 -f`,
		RunE: func(cmd *cobra.Command, args []string) error {
			task, _ := cmd.Flags().GetString("scenario")
			pack, _ := cmd.Flags().GetString("pack")
			config, _ := cmd.Flags().GetString("config")
			model, _ := cmd.Flags().GetString("model")
			concurrency, _ := cmd.Flags().GetInt("concurrency")
			forceBuild, _ := cmd.Flags().GetBool("force-build")

			if task == "" && config == "" {
				return fmt.Errorf("either --scenario or --config is required")
			}
			if task != "" && config != "" {
				return fmt.Errorf("--scenario and --config are mutually exclusive")
			}
			if pack != "" && config != "" {
				return fmt.Errorf("--pack is only valid with --scenario, not --config")
			}

			opts := evalRunOpts{
				model:       model,
				concurrency: concurrency,
				forceBuild:  forceBuild,
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
	cmd.Flags().StringP("model", "m", "anthropic/claude-sonnet-4-6", "Model to use for agent and judge")
	cmd.Flags().Int("concurrency", 1, "Number of concurrent trials")
	cmd.Flags().BoolP("force-build", "f", false, "Force Docker image rebuild")
	return cmd
}
