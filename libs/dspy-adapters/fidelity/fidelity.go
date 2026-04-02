// Package fidelity provides the dspy-go fidelity judge signature and runner.
package fidelity

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/XiaoConstantine/dspy-go/pkg/modules"
)

// Scores holds the three-axis fidelity scores.
type Scores struct {
	Coverage     float64
	Grounding    float64
	Faithfulness float64
	Composite    float64
	Reasoning    string
	Rationale    string
}

// DefaultRubric is the built-in fidelity rubric.
const DefaultRubric = `Evaluate the rendered content against the source entries on three axes:

COVERAGE (0.0-1.0):
- Identify each distinct topic/fact in the source entries
- Check if each is represented in the rendered content
- Score = (represented topics) / (total source topics)
- A topic can be restructured or summarized but must be present

GROUNDING (0.0-1.0):
- Identify each distinct claim/fact in the rendered content
- Check if each is traceable to a specific source entry
- Score = (grounded claims) / (total rendered claims)
- Restructured content is fine if the underlying fact comes from a source

FAITHFULNESS (0.0-1.0):
- For content that IS represented, check semantic accuracy
- Is the meaning preserved? Any distortions, inversions, or misquotes?
- Score = (accurate representations) / (total representations)
- Summarization is fine; misrepresentation is not`

// NewSignature creates the dspy-go signature for fidelity judging.
func NewSignature() core.Signature {
	return core.NewSignature(
		[]core.InputField{
			{Field: core.Field{
				Name:        "source_entries",
				Description: "The original source entries from the context pack, in markdown format",
			}},
			{Field: core.Field{
				Name:        "rendered_content",
				Description: "The agent-rendered markdown derived from the source entries",
			}},
			{Field: core.Field{
				Name:        "rubric",
				Description: "The fidelity scoring rubric with criteria definitions",
			}},
		},
		[]core.OutputField{
			{Field: core.Field{
				Name:        "coverage",
				Description: "Score 0.0-1.0: fraction of source entries represented in rendered content. 1.0 means all source entries are covered.",
			}},
			{Field: core.Field{
				Name:        "grounding",
				Description: "Score 0.0-1.0: fraction of rendered content traceable to source entries. 1.0 means everything comes from sources.",
			}},
			{Field: core.Field{
				Name:        "faithfulness",
				Description: "Score 0.0-1.0: semantic accuracy of represented content. 1.0 means source content is accurately represented.",
			}},
			{Field: core.Field{
				Name:        "reasoning",
				Description: "Detailed step-by-step analysis explaining each score.",
			}},
		},
	).WithInstruction(`You are a fidelity judge for rendered context packs. Your job is to evaluate
whether a rendered markdown document faithfully represents its source entries.

Score each axis independently and precisely. Be critical — the purpose is to
catch content drift, hallucination, and cherry-picking.`)
}

// Judge runs the fidelity check and returns structured scores.
func Judge(
	ctx context.Context,
	sourceEntries,
	renderedContent,
	rubric string,
) (*Scores, error) {
	sig := NewSignature()
	cot := modules.NewChainOfThought(sig).WithStructuredOutput()

	result, err := cot.Process(ctx, map[string]any{
		"source_entries":   sourceEntries,
		"rendered_content": renderedContent,
		"rubric":           rubric,
	})
	if err != nil {
		return nil, fmt.Errorf("fidelity judge failed: %w", err)
	}

	scores := &Scores{}

	scores.Coverage, err = parseRequiredScore(result, "coverage")
	if err != nil {
		return nil, err
	}
	scores.Grounding, err = parseRequiredScore(result, "grounding")
	if err != nil {
		return nil, err
	}
	scores.Faithfulness, err = parseRequiredScore(result, "faithfulness")
	if err != nil {
		return nil, err
	}
	if v, ok := result["reasoning"]; ok {
		scores.Reasoning = fmt.Sprintf("%v", v)
	}
	if v, ok := result["rationale"]; ok {
		scores.Rationale = fmt.Sprintf("%v", v)
	}

	scores.Composite = min(
		scores.Coverage,
		scores.Grounding,
		scores.Faithfulness,
	)

	return scores, nil
}

func parseFloat(v any) (float64, error) {
	switch val := v.(type) {
	case float64:
		return val, nil
	case string:
		if strings.TrimSpace(val) == "" {
			return 0, fmt.Errorf("empty string for score")
		}
		return strconv.ParseFloat(val, 64)
	default:
		return 0, fmt.Errorf("unexpected type %T for score", v)
	}
}

func parseRequiredScore(result map[string]any, field string) (float64, error) {
	raw, ok := result[field]
	if !ok {
		return 0, fmt.Errorf("fidelity judge missing %q score", field)
	}

	score, err := parseFloat(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid %q score: %w", field, err)
	}
	if score < 0 || score > 1 {
		return 0, fmt.Errorf("invalid %q score: out of range [0,1]", field)
	}

	return score, nil
}

func min(values ...float64) float64 {
	m := values[0]
	for _, v := range values[1:] {
		if v < m {
			m = v
		}
	}
	return m
}
