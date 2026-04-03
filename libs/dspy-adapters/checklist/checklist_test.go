package checklist

import "testing"

func TestParseScoresAcceptsJSONString(t *testing.T) {
	t.Parallel()

	items, err := parseScores(`[{"name":"Criterion A","score":2,"max_score":4,"evidence":"ok"}]`)
	if err != nil {
		t.Fatalf("parseScores: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Name != "Criterion A" {
		t.Fatalf("unexpected item: %+v", items[0])
	}
}

func TestNormalizeScoreKey(t *testing.T) {
	t.Parallel()

	if got := normalizeScoreKey("OpenAPI spec generation mentioned"); got != "openapi_spec_generation_mentioned" {
		t.Fatalf("normalizeScoreKey() = %q", got)
	}
}
