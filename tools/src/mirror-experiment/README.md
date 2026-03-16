# Mirror Experiment

Testing the "mirror effect" on coding agents — does telling an agent its work
is being evaluated improve output quality?

## Structure

```
mirror-experiment/
├── README.md                 # This file
├── RESEARCH.md               # Full research report with all findings
├── experiment.ts             # A/B testing tool (control vs mirror prompts)
├── gepa-smoke-test.ts        # Minimal GEPA + AxAIClaudeAgentSDK proof
└── results/                  # Raw JSON data (gitignored)
```

## Quick Start

```bash
# A/B test: control vs built-in mirror (5 runs, 2 concurrent)
pnpm --filter @moltnet/tools mirror:experiment --runs 5 --concurrency 2

# Different models
pnpm --filter @moltnet/tools mirror:experiment --runs 5 --model claude-haiku-4-5
pnpm --filter @moltnet/tools mirror:experiment --runs 5 --model claude-opus-4-6

# Custom mirror prompt file(s)
pnpm --filter @moltnet/tools mirror:experiment --runs 5 --mirror-file path/to/prompt.md

# Multiple conditions at once
pnpm --filter @moltnet/tools mirror:experiment --runs 5 --concurrency 3 \
  --mirror-file negative.md --mirror-file positive.md

# GEPA smoke test (verify AxAIClaudeAgentSDK + GEPA works)
pnpm --filter @moltnet/tools mirror:gepa-smoke
```

## Key Findings

See [RESEARCH.md](./RESEARCH.md) for the full report. Summary:

1. **Mirror helps weak models, hurts strong ones** — Haiku +19%, Sonnet ±4%, Opus -14%
2. **Mirror reliably reduces false positives** across all models (-36% overall)
3. **Optimized prompts are model-specific** — a Haiku-optimized prompt hurts Sonnet
4. **Concurrent evaluation** via `fastq` cuts experiment time by ~2.5x
