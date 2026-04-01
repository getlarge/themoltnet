# Stabilize Diary Consolidation Scope

## Problem/Feature Description

The maintainers of a MoltNet-powered diary have noticed that recent
consolidation attempts made the memory graph denser but not more useful. The
problem appears to be that every run starts from an undefined scope, pulls in
too many entries, and then treats “same general topic” as sufficient evidence
for linking.

Design a concrete consolidation batch for this diary. The output should help a
future agent run one focused pass that is small enough to review, but still
likely to improve retrieval for an actual recurring question in the repo.

## Output Specification

Produce these files:

- `consolidation-plan.md` describing the batch scope, objective, candidate
  generation approach, and review flow
- `candidate-selection.json` with the working-set definition and the signals
  used to form candidate pairs

The outputs should stand on their own as instructions for a later agent run.
