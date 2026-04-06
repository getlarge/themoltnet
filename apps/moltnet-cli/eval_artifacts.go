package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/checklist"
)

const artifactSchemaVersion = "2026-04-03"

// --- trajectory.json (Phase 0 contract) ---

type trajectoryStep struct {
	Index      int    `json:"index"`
	Timestamp  string `json:"timestamp,omitempty"`
	Source     string `json:"source"` // agent, user, system
	Kind       string `json:"kind"`   // message, tool_call, tool_result, system, error
	ToolName   string `json:"tool_name,omitempty"`
	Input      string `json:"input,omitempty"`
	Output     string `json:"output,omitempty"`
	IsError    bool   `json:"is_error,omitempty"`
	DurationMs int64  `json:"duration_ms,omitempty"`
}

type trajectorySummary struct {
	NumTurns            int     `json:"num_turns"`
	NumSteps            int     `json:"num_steps"`
	PermissionDenials   int     `json:"permission_denials"`
	InputTokens         int     `json:"input_tokens"`
	OutputTokens        int     `json:"output_tokens"`
	CacheCreationTokens int     `json:"cache_creation_tokens"`
	CacheReadTokens     int     `json:"cache_read_tokens"`
	CostUSD             float64 `json:"cost_usd"`
}

type normalizedTrajectory struct {
	SchemaVersion string            `json:"schema_version"`
	Engine        string            `json:"engine"`
	SessionID     string            `json:"session_id"`
	TraceID       string            `json:"trace_id,omitempty"`
	StartedAt     string            `json:"started_at,omitempty"`
	FinishedAt    string            `json:"finished_at,omitempty"`
	FinalResult   string            `json:"final_result"`
	IsError       bool              `json:"is_error"`
	Summary       trajectorySummary `json:"summary"`
	Steps         []trajectoryStep  `json:"steps"`
}

// normalizeTrajectory transforms raw stream-json events into the Phase 0
// contract trajectory schema. This is adapter-agnostic: it works with any
// stream-json producer (Claude CLI, Codex, etc.) as long as events follow
// the standard {type, message, result} envelope.
func normalizeTrajectory(agent *dspyAgentRunResult) *normalizedTrajectory {
	traj := &normalizedTrajectory{
		SchemaVersion: artifactSchemaVersion,
		Engine:        "dspy",
		SessionID:     agent.sessionID,
		FinalResult:   agent.output,
		Summary: trajectorySummary{
			NumTurns:        agent.numTurns,
			CostUSD:         agent.costUSD,
			InputTokens:     agent.inputTokens,
			OutputTokens:    agent.outputTokens,
			CacheReadTokens: agent.cachedInputTokens,
		},
	}

	stepIdx := 0
	for _, line := range agent.trajectory {
		var evt map[string]any
		if err := json.Unmarshal(line, &evt); err != nil {
			continue
		}

		evtType, _ := evt["type"].(string)
		switch evtType {
		// Claude stream-json events
		case "assistant":
			steps := extractStepsFromAssistant(evt, &stepIdx)
			traj.Steps = append(traj.Steps, steps...)

		case "result":
			sessionID, _ := evt["session_id"].(string)
			if sessionID != "" {
				traj.SessionID = sessionID
			}
			if isErr, ok := evt["is_error"].(bool); ok {
				traj.IsError = isErr
			}
			// Claude result events carry usage — override if present
			// (the agent struct may already have these from parseStreamJSON).
			if usage, ok := evt["usage"].(map[string]any); ok {
				if v, ok := usage["input_tokens"].(float64); ok {
					traj.Summary.InputTokens = int(v)
				}
				if v, ok := usage["output_tokens"].(float64); ok {
					traj.Summary.OutputTokens = int(v)
				}
				if v, ok := usage["cache_creation_input_tokens"].(float64); ok {
					traj.Summary.CacheCreationTokens = int(v)
				}
				if v, ok := usage["cache_read_input_tokens"].(float64); ok {
					traj.Summary.CacheReadTokens = int(v)
				}
			}
			if denials, ok := evt["permission_denials"].([]any); ok {
				traj.Summary.PermissionDenials = len(denials)
			}

		// Codex JSONL events
		case "item.completed":
			steps := extractStepsFromCodexItem(evt, &stepIdx)
			traj.Steps = append(traj.Steps, steps...)

		case "turn.completed":
			// Usage already accumulated in agent struct; nothing extra to do.
		}
	}

	traj.Summary.NumSteps = len(traj.Steps)
	return traj
}

// extractStepsFromCodexItem parses a Codex item.completed event into trajectory steps.
func extractStepsFromCodexItem(evt map[string]any, stepIdx *int) []trajectoryStep {
	item, ok := evt["item"].(map[string]any)
	if !ok {
		return nil
	}
	itemType, _ := item["type"].(string)
	*stepIdx++

	switch itemType {
	case "agent_message":
		text, _ := item["text"].(string)
		if text == "" {
			return nil
		}
		return []trajectoryStep{{
			Index:  *stepIdx,
			Source: "agent",
			Kind:   "message",
			Output: truncate(text, 500),
		}}
	case "command_execution":
		cmd, _ := item["command"].(string)
		output, _ := item["aggregated_output"].(string)
		exitCode := -1
		if v, ok := item["exit_code"].(float64); ok {
			exitCode = int(v)
		}
		return []trajectoryStep{{
			Index:    *stepIdx,
			Source:   "agent",
			Kind:     "tool_call",
			ToolName: "command_execution",
			Input:    truncate(cmd, 500),
			Output:   truncate(output, 500),
			IsError:  exitCode != 0,
		}}
	}
	return nil
}

// extractStepsFromAssistant parses content blocks from an assistant message
// event into normalized trajectory steps.
func extractStepsFromAssistant(evt map[string]any, stepIdx *int) []trajectoryStep {
	msg, ok := evt["message"].(map[string]any)
	if !ok {
		return nil
	}
	content, ok := msg["content"].([]any)
	if !ok {
		return nil
	}

	var steps []trajectoryStep
	for _, block := range content {
		b, ok := block.(map[string]any)
		if !ok {
			continue
		}
		blockType, _ := b["type"].(string)
		*stepIdx++

		switch blockType {
		case "tool_use":
			toolName, _ := b["name"].(string)
			input := summarizeInput(b["input"])
			steps = append(steps, trajectoryStep{
				Index:    *stepIdx,
				Source:   "agent",
				Kind:     "tool_call",
				ToolName: toolName,
				Input:    input,
			})
		case "tool_result":
			toolID, _ := b["tool_use_id"].(string)
			isError, _ := b["is_error"].(bool)
			output := summarizeOutput(b["content"])
			steps = append(steps, trajectoryStep{
				Index:    *stepIdx,
				Source:   "agent",
				Kind:     "tool_result",
				ToolName: toolID,
				Output:   output,
				IsError:  isError,
			})
		case "text":
			text, _ := b["text"].(string)
			if text != "" {
				steps = append(steps, trajectoryStep{
					Index:  *stepIdx,
					Source: "agent",
					Kind:   "message",
					Output: truncate(text, 500),
				})
			}
		}
	}
	return steps
}

// --- trial_result.json (Phase 0 contract) ---

type trialResultScenario struct {
	Name    string `json:"name"`
	Path    string `json:"path,omitempty"`
	Variant string `json:"variant"`
}

type trialResultAgent struct {
	Name  string `json:"name"`
	Model string `json:"model"`
}

type trialResultScores struct {
	NormalizedReward float64            `json:"normalized_reward"`
	Criteria         map[string]float64 `json:"criteria"`
}

type trialResultTimings struct {
	AgentMs int64 `json:"agent"`
	JudgeMs int64 `json:"judge"`
	TotalMs int64 `json:"total"`
}

type trialResultUsageDetail struct {
	InputTokens         int     `json:"input_tokens"`
	OutputTokens        int     `json:"output_tokens"`
	CacheCreationTokens int     `json:"cache_creation_tokens"`
	CacheReadTokens     int     `json:"cache_read_tokens"`
	CostUSD             float64 `json:"cost_usd"`
}

type trialResultUsage struct {
	Agent        trialResultUsageDetail `json:"agent"`
	Judge        trialResultUsageDetail `json:"judge"`
	TotalCostUSD float64                `json:"total_cost_usd"`
}

type trialResultArtifacts struct {
	Trajectory string `json:"trajectory"`
	Trace      string `json:"trace"`
	AgentLog   string `json:"agent_log"`
	JudgeLog   string `json:"judge_log"`
}

type trialResultError struct {
	Category      string `json:"category"`
	Code          string `json:"code"`
	Message       string `json:"message"`
	RetryAttempts int    `json:"retry_attempts"`
	Retryable     bool   `json:"retryable"`
}

type normalizedTrialResult struct {
	SchemaVersion string               `json:"schema_version"`
	Engine        string               `json:"engine"`
	JobID         string               `json:"job_id"`
	TrialID       string               `json:"trial_id"`
	Scenario      trialResultScenario  `json:"scenario"`
	Agent         trialResultAgent     `json:"agent"`
	Judge         trialResultAgent     `json:"judge"`
	Status        string               `json:"status"`
	Scores        trialResultScores    `json:"scores"`
	Timings       trialResultTimings   `json:"timings_ms"`
	Usage         trialResultUsage     `json:"usage"`
	Artifacts     trialResultArtifacts `json:"artifacts"`
	Error         *trialResultError    `json:"error"`
}

func buildTrialResult(
	jobID string,
	scenarioName string,
	variant string, // "without-context" or "with-context"
	agent *dspyAgentRunResult,
	judged *checklist.Result,
	judgeMs int64,
	resolvedAgent, resolvedModel string,
	opts evalRunOpts,
) *normalizedTrialResult {
	tr := &normalizedTrialResult{
		SchemaVersion: artifactSchemaVersion,
		Engine:        "dspy",
		JobID:         jobID,
		TrialID:       fmt.Sprintf("trial_%s_%s", scenarioName, variant),
		Scenario: trialResultScenario{
			Name:    scenarioName,
			Variant: variant,
		},
		Agent: trialResultAgent{
			Name:  resolvedAgent,
			Model: resolvedModel,
		},
		Judge: trialResultAgent{
			Name:  opts.judge,
			Model: opts.judgeModel,
		},
		Timings: trialResultTimings{
			AgentMs: agent.durationMs,
			JudgeMs: judgeMs,
			TotalMs: agent.durationMs + judgeMs,
		},
		Usage: buildTrialUsage(agent, judged),
		Artifacts: trialResultArtifacts{
			Trajectory: "trajectory.json",
			Trace:      "trace.jsonl",
			AgentLog:   "agent-output.txt",
			JudgeLog:   "verifier/reasoning.txt",
		},
	}

	if judged != nil {
		tr.Status = "success"
		tr.Scores = trialResultScores{
			NormalizedReward: judged.Reward,
			Criteria:         judged.Details,
		}
	}

	return tr
}

func buildTrialUsage(agent *dspyAgentRunResult, judged *checklist.Result) trialResultUsage {
	u := trialResultUsage{
		Agent: trialResultUsageDetail{
			InputTokens:     agent.inputTokens,
			OutputTokens:    agent.outputTokens,
			CacheReadTokens: agent.cachedInputTokens,
			CostUSD:         agent.costUSD,
		},
		TotalCostUSD: agent.costUSD,
	}
	if judged != nil && judged.Usage != nil {
		u.Judge = trialResultUsageDetail{
			InputTokens:  judged.Usage.PromptTokens,
			OutputTokens: judged.Usage.CompletionTokens,
		}
	}
	return u
}

func buildTrialResultError(
	jobID string,
	scenarioName string,
	variant string,
	agent *dspyAgentRunResult,
	errMsg string,
	resolvedAgent, resolvedModel string,
	opts evalRunOpts,
) *normalizedTrialResult {
	tr := buildTrialResult(jobID, scenarioName, variant, agent, nil, 0, resolvedAgent, resolvedModel, opts)
	tr.Status = classifyErrorStatus(errMsg)
	tr.Error = &trialResultError{
		Category: classifyErrorCategory(errMsg),
		Code:     "eval_error",
		Message:  errMsg,
	}
	return tr
}

// --- job_result.json (Phase 0 contract) ---

type jobResultSummary struct {
	ScenarioCount    int     `json:"scenario_count"`
	TrialCount       int     `json:"trial_count"`
	CompletionRate   float64 `json:"completion_rate"`
	InfraFailureRate float64 `json:"infra_failure_rate"`
	JudgeFailureRate float64 `json:"judge_failure_rate"`
	TotalCostUSD     float64 `json:"total_cost_usd"`
	TotalRuntimeMs   int64   `json:"total_runtime_ms"`
	AverageDelta     float64 `json:"average_delta"`
}

type jobResultEntry struct {
	Scenario       string            `json:"scenario"`
	WithoutContext *jobResultVariant `json:"without_context"`
	WithContext    *jobResultVariant `json:"with_context,omitempty"`
	Delta          *float64          `json:"delta"`
}

type jobResultVariant struct {
	Status           string  `json:"status"`
	NormalizedReward float64 `json:"normalized_reward"`
	TrialPath        string  `json:"trial_path"`
}

type normalizedJobResult struct {
	SchemaVersion string           `json:"schema_version"`
	Engine        string           `json:"engine"`
	JobID         string           `json:"job_id"`
	StartedAt     string           `json:"started_at"`
	FinishedAt    string           `json:"finished_at"`
	Agent         trialResultAgent `json:"agent"`
	Judge         trialResultAgent `json:"judge"`
	Summary       jobResultSummary `json:"summary"`
	Results       []jobResultEntry `json:"results"`
}

func buildJobResult(
	jobID string,
	startedAt time.Time,
	results []evalResult,
	opts evalRunOpts,
) *normalizedJobResult {
	jr := &normalizedJobResult{
		SchemaVersion: artifactSchemaVersion,
		Engine:        "dspy",
		JobID:         jobID,
		StartedAt:     startedAt.UTC().Format(time.RFC3339),
		FinishedAt:    time.Now().UTC().Format(time.RFC3339),
		Agent: trialResultAgent{
			Name:  opts.agent,
			Model: opts.model,
		},
		Judge: trialResultAgent{
			Name:  opts.judge,
			Model: opts.judgeModel,
		},
	}

	var totalTrials, successTrials, infraFails, judgeFails int
	var totalCost float64
	var deltas []float64

	for _, r := range results {
		entry := jobResultEntry{Scenario: r.taskName}
		variants := 0

		if r.withoutContext != nil {
			variants++
			totalTrials++
			status := "success"
			if r.withoutContext.err != "" {
				status = classifyErrorStatus(r.withoutContext.err)
				switch classifyErrorCategory(r.withoutContext.err) {
				case "infra":
					infraFails++
				case "judge":
					judgeFails++
				}
			} else {
				successTrials++
			}
			entry.WithoutContext = &jobResultVariant{
				Status:           status,
				NormalizedReward: r.withoutContext.reward,
				TrialPath:        fmt.Sprintf("%s/without-context", r.taskName),
			}
		}

		if r.withContext != nil {
			variants++
			totalTrials++
			status := "success"
			if r.withContext.err != "" {
				status = classifyErrorStatus(r.withContext.err)
				switch classifyErrorCategory(r.withContext.err) {
				case "infra":
					infraFails++
				case "judge":
					judgeFails++
				}
			} else {
				successTrials++
			}
			entry.WithContext = &jobResultVariant{
				Status:           status,
				NormalizedReward: r.withContext.reward,
				TrialPath:        fmt.Sprintf("%s/with-context", r.taskName),
			}
		}

		if r.withoutContext != nil && r.withContext != nil &&
			r.withoutContext.err == "" && r.withContext.err == "" {
			d := r.withContext.reward - r.withoutContext.reward
			entry.Delta = &d
			deltas = append(deltas, d)
		}

		jr.Results = append(jr.Results, entry)
		_ = variants
	}

	jr.Summary = jobResultSummary{
		ScenarioCount: len(results),
		TrialCount:    totalTrials,
		TotalCostUSD:  totalCost,
	}
	if totalTrials > 0 {
		jr.Summary.CompletionRate = float64(successTrials) / float64(totalTrials)
		jr.Summary.InfraFailureRate = float64(infraFails) / float64(totalTrials)
		jr.Summary.JudgeFailureRate = float64(judgeFails) / float64(totalTrials)
	}
	if len(deltas) > 0 {
		sum := 0.0
		for _, d := range deltas {
			sum += d
		}
		jr.Summary.AverageDelta = sum / float64(len(deltas))
	}

	return jr
}

// --- trace.jsonl helpers ---

type traceEvent struct {
	SchemaVersion string         `json:"schema_version"`
	Engine        string         `json:"engine"`
	Component     string         `json:"component"` // agent_runner, judge, orchestrator
	Type          string         `json:"type"`      // session, span, llm_call, error
	Timestamp     string         `json:"timestamp"`
	TraceID       string         `json:"trace_id"`
	SpanID        string         `json:"span_id,omitempty"`
	ParentID      string         `json:"parent_id,omitempty"`
	Data          map[string]any `json:"data"`
}

func newTraceEvent(component, eventType, traceID string, data map[string]any) traceEvent {
	return traceEvent{
		SchemaVersion: artifactSchemaVersion,
		Engine:        "dspy",
		Component:     component,
		Type:          eventType,
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		TraceID:       traceID,
		Data:          data,
	}
}

// --- Helpers ---

func classifyErrorStatus(errMsg string) string {
	switch {
	case containsAny(errMsg, "auth", "OAuth", "API key", "Unauthorized", "Not logged in"):
		return "auth_error"
	case containsAny(errMsg, "judge", "scores_json", "coverage", "fidelity"):
		return "judge_error"
	case containsAny(errMsg, "ECONNRESET", "TLS", "timeout", "connection"):
		return "infra_error"
	default:
		return "task_failure"
	}
}

func classifyErrorCategory(errMsg string) string {
	switch classifyErrorStatus(errMsg) {
	case "auth_error":
		return "auth"
	case "judge_error":
		return "judge"
	case "infra_error":
		return "infra"
	default:
		return "task"
	}
}

func containsAny(s string, substrs ...string) bool {
	for _, sub := range substrs {
		if len(s) >= len(sub) {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
		}
	}
	return false
}

func summarizeInput(v any) string {
	switch val := v.(type) {
	case map[string]any:
		// For tool calls, summarize key fields
		if cmd, ok := val["command"].(string); ok {
			return truncate(cmd, 200)
		}
		if fp, ok := val["file_path"].(string); ok {
			return fp
		}
		if pat, ok := val["pattern"].(string); ok {
			return pat
		}
		if desc, ok := val["description"].(string); ok {
			return truncate(desc, 200)
		}
		// Fallback: marshal
		b, _ := json.Marshal(val)
		return truncate(string(b), 200)
	case string:
		return truncate(val, 200)
	default:
		return ""
	}
}

func summarizeOutput(v any) string {
	switch val := v.(type) {
	case string:
		return truncate(val, 200)
	case []any:
		if len(val) > 0 {
			if block, ok := val[0].(map[string]any); ok {
				if text, ok := block["text"].(string); ok {
					return truncate(text, 200)
				}
			}
		}
	}
	return ""
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
