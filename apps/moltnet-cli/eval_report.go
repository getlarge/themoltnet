package main

import (
	"github.com/getlarge/themoltnet/libs/dspy-adapters/checklist"
)

// trialScores holds parsed scores for a single trial.
type trialScores struct {
	name           string
	logDir         string
	reward         float64
	details        map[string]float64
	scoredCriteria []checklist.ScoredCriterion // per-criterion evidence (dspy only)
	err            string                      // non-empty if the trial failed
}

// evalResult holds the outcome for one eval task.
type evalResult struct {
	taskName       string
	withContext    *trialScores
	withoutContext *trialScores
}
