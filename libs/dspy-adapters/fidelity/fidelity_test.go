package fidelity

import "testing"

func TestParseRequiredScoreRequiresField(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{}, "coverage")
	if err == nil {
		t.Fatal("expected error for missing score field")
	}
}

func TestParseRequiredScoreRejectsNonNumeric(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": "oops"}, "coverage")
	if err == nil {
		t.Fatal("expected error for unparseable score")
	}
}

func TestParseRequiredScoreRejectsOutOfRange(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": 1.2}, "coverage")
	if err == nil {
		t.Fatal("expected out-of-range error")
	}
}

func TestParseRequiredScoreRejectsEmptyString(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": ""}, "coverage")
	if err == nil {
		t.Fatal("expected error for empty string score")
	}
}

func TestParseRequiredScoreRejectsWhitespaceString(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": "  "}, "coverage")
	if err == nil {
		t.Fatal("expected error for whitespace-only score")
	}
}
