package solver

import "github.com/XiaoConstantine/dspy-go/pkg/core"

// VitroSignature returns the core.Signature used by vitro-mode eval runs.
//
// Inputs:
//   - task_markdown: full task.md contents
//   - context_pack:  rendered context pack markdown (empty string for baseline)
//
// Outputs:
//   - reasoning:         step-by-step reasoning and plan
//   - workspace_summary: narration of what the agent wrote to the workspace
//
// Note: workspace_summary is intentionally belt-and-suspenders. The judge
// still reads the filesystem via buildWorkspaceSnapshot as ground truth;
// this field exists so the dspy-go module has a place to narrate its work,
// which is what GEPA needs to optimize against later. Do not delete it
// thinking it's dead code.
func VitroSignature() core.Signature {
	return core.NewSignature(
		[]core.InputField{
			{Field: core.Field{
				Name:        "task_markdown",
				Description: "Full task.md contents describing the task to complete",
			}},
			{Field: core.Field{
				Name:        "context_pack",
				Description: "Rendered context pack markdown (empty string for baseline variant)",
			}},
		},
		[]core.OutputField{
			{Field: core.Field{
				Name:        "reasoning",
				Description: "Step-by-step reasoning and plan before acting",
			}},
			{Field: core.Field{
				Name:        "workspace_summary",
				Description: "Summary of files written to the workspace and what they contain",
			}},
		},
	)
}

// VivoSignature returns the core.Signature used by vivo-mode eval runs.
//
// Used by vivo-mode eval runs with the ReAct solver (KindReAct). The
// tool_trace output field captures dspy-go-observed tool calls from the
// ReAct loop for the runner to extract via TraceProvider.
func VivoSignature() core.Signature {
	return core.NewSignature(
		[]core.InputField{
			{Field: core.Field{
				Name:        "task_markdown",
				Description: "Full task.md contents describing the task to complete",
			}},
			{Field: core.Field{
				Name:        "context_pack",
				Description: "Rendered context pack markdown (empty string for baseline variant)",
			}},
			{Field: core.Field{
				Name:        "repo_ref",
				Description: "Pinned commit the worktree is anchored to (fixture.ref)",
			}},
		},
		[]core.OutputField{
			{Field: core.Field{
				Name:        "reasoning",
				Description: "Step-by-step reasoning and plan before acting",
			}},
			{Field: core.Field{
				Name:        "workspace_summary",
				Description: "Summary of files written to the workspace and what they contain",
			}},
			{Field: core.Field{
				Name:        "tool_trace",
				Description: "dspy-go-observed tool calls issued during the ReAct loop",
			}},
		},
	)
}
