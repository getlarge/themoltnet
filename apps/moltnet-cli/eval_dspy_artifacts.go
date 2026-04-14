package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/checklist"
)

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
	if agent.toolTrace != "" && agent.toolTrace != "[]" {
		if err := os.WriteFile(filepath.Join(variantDir, "tool_trace.json"), []byte(agent.toolTrace), 0o644); err != nil {
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
