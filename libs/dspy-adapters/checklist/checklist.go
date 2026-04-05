// Package checklist provides a DSPy-based weighted checklist judge for eval outputs.
package checklist

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
	dspyadapters "github.com/getlarge/themoltnet/libs/dspy-adapters"
)

type Criterion struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	MaxScore    float64 `json:"max_score"`
}

type Criteria struct {
	Type      string      `json:"type"`
	Context   string      `json:"context"`
	Checklist []Criterion `json:"checklist"`
}

type ScoredCriterion struct {
	Name     string  `json:"name"`
	Score    float64 `json:"score"`
	MaxScore float64 `json:"max_score"`
	Evidence string  `json:"evidence"`
}

type Result struct {
	Reward    float64
	Details   map[string]float64
	Scores    []ScoredCriterion
	Reasoning string
}

type Request struct {
	// LLM is an explicit LLM instance for concurrent-safe execution.
	// When set, Provider and Model are ignored and no global state is mutated.
	LLM              core.LLM
	Provider         string
	Model            string
	WorkspaceSummary string
	Criteria         Criteria
}

func NewSignature() core.Signature {
	return core.NewSignature(
		[]core.InputField{
			{Field: core.Field{Name: "workspace_summary", Description: "Markdown summary of the files produced by the agent"}},
			{Field: core.Field{Name: "criteria_json", Description: "Weighted checklist criteria as JSON"}},
		},
		[]core.OutputField{
			{Field: core.Field{Name: "scores_json", Description: "JSON array of criterion objects with name, score, max_score, and evidence"}},
			{Field: core.Field{Name: "reasoning", Description: "Short explanation of how the checklist was applied"}},
		},
	).WithInstruction(`You are an eval judge. Score the agent output against the weighted checklist criteria.

Use only the workspace summary you were given.

Return scores_json as a JSON array:
[
  { "name": "criterion name", "score": <number>, "max_score": <number>, "evidence": "one sentence" }
]

Each score must be between 0 and max_score inclusive.`)
}

func Run(ctx context.Context, req Request) (*Result, error) {
	llm := req.LLM
	if llm == nil {
		var err error
		llm, err = dspyadapters.InitProvider(req.Provider, req.Model)
		if err != nil {
			return nil, err
		}
	}

	criteriaJSON, err := json.Marshal(req.Criteria)
	if err != nil {
		return nil, dspyerrors.Wrap(err, dspyerrors.InvalidInput, "marshal criteria json")
	}

	sig := NewSignature()
	result, err := dspyadapters.RunJudgeStructured(ctx, llm, sig, map[string]any{
		"workspace_summary": req.WorkspaceSummary,
		"criteria_json":     string(criteriaJSON),
	})
	if err != nil {
		return nil, dspyerrors.WithFields(
			dspyerrors.Wrap(err, dspyerrors.WorkflowExecutionFailed, "checklist judge failed"),
			dspyerrors.Fields{"module": "checklist"},
		)
	}

	items, err := parseScores(result["scores_json"])
	if err != nil {
		return nil, err
	}

	out := &Result{
		Details: make(map[string]float64, len(items)),
		Scores:  items,
	}
	if v, ok := result["reasoning"]; ok {
		out.Reasoning = fmt.Sprintf("%v", v)
	}

	var total float64
	var maxTotal float64
	for _, item := range items {
		total += item.Score
		maxTotal += item.MaxScore
		if item.MaxScore > 0 {
			out.Details[normalizeScoreKey(item.Name)] = item.Score / item.MaxScore
		} else {
			out.Details[normalizeScoreKey(item.Name)] = 0
		}
	}
	if maxTotal > 0 {
		out.Reward = total / maxTotal
	}

	return out, nil
}

func parseScores(raw any) ([]ScoredCriterion, error) {
	if raw == nil {
		return nil, dspyerrors.New(dspyerrors.InvalidResponse, "checklist judge missing scores_json")
	}

	var payload []byte
	switch val := raw.(type) {
	case string:
		text := strings.TrimSpace(val)
		if text == "" {
			return nil, dspyerrors.New(dspyerrors.InvalidResponse, "checklist judge missing scores_json")
		}
		payload = []byte(text)
	default:
		var err error
		payload, err = json.Marshal(val)
		if err != nil {
			return nil, dspyerrors.Wrap(err, dspyerrors.InvalidResponse, "invalid checklist scores_json")
		}
	}

	var items []ScoredCriterion
	if err := json.Unmarshal(payload, &items); err != nil {
		return nil, dspyerrors.Wrap(err, dspyerrors.InvalidResponse, "invalid checklist scores_json")
	}
	for _, item := range items {
		if strings.TrimSpace(item.Name) == "" {
			return nil, dspyerrors.New(dspyerrors.InvalidResponse, "checklist judge returned empty criterion name")
		}
		if item.Score < 0 || item.Score > item.MaxScore {
			return nil, dspyerrors.New(
				dspyerrors.InvalidResponse,
				fmt.Sprintf("checklist score out of range for %q", item.Name),
			)
		}
	}
	return items, nil
}

func normalizeScoreKey(name string) string {
	var b strings.Builder
	lastUnderscore := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		case !lastUnderscore:
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}
