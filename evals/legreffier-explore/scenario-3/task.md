# Context Pack Recipe Generator

## Problem/Feature Description

A team uses a diary system with a "compile" feature that generates context packs — curated subsets of diary entries optimized for a specific task. Each compile call takes parameters like token budget, search weights, and tag filters. Designing good recipes requires understanding what's in the diary first.

The team has already inventoried their diary (they know the tags, entry types, and distributions). Now they need a tool that recommends compile recipes tailored to their specific diary content, and identifies topics the diary should cover but doesn't.

## Output Specification

Create the following files:

1. `recipe-generator.ts` — A TypeScript module that exports:
   - A `InventorySummary` type representing pre-computed diary statistics
   - A `generateRecipes(inventory: InventorySummary, projectStructure: string[]): CompileRecipe[]` function
   - A `findCoverageGaps(inventory: InventorySummary, projectStructure: string[]): CoverageGap[]` function
   - A `CompileRecipe` type with all required recipe fields
   - A `identifyNoiseSources(inventory: InventorySummary): NoiseSource[]` function

2. `recipes-output.yaml` — Sample recipes generated from the provided inventory, formatted as YAML.

3. `gap-analysis.md` — A document listing coverage gaps found and noise sources identified, with evidence for each.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/inventory-summary.json ===============
{
"totalEntries": 87,
"entryTypes": {"procedural": 45, "semantic": 20, "episodic": 12, "reflection": 5, "identity": 1, "soul": 1, "scan": 3},
"tagNamespaces": {
"branch": {"feat/auth": 15, "feat/api": 12, "feat/db": 10, "fix/deploy": 5, "main": 3},
"scope": {"auth": 15, "api": 12, "db": 10, "ci": 5, "crypto": 3, "mcp": 2},
"risk": {"high": 10, "medium": 20, "low": 15},
"source": {"scorecard": 3},
"learn": {"trace": 8}
},
"tags": {"accountable-commit": 45, "decision": 20, "incident": 10, "reflection": 5, "workaround": 4, "exploration": 1, "scan-category:summary": 3},
"importanceDistribution": {"1": 2, "2": 5, "3": 8, "4": 10, "5": 15, "6": 12, "7": 15, "8": 12, "9": 5, "10": 3},
"temporalRange": {"earliest": "2026-01-10T00:00:00Z", "latest": "2026-03-20T15:00:00Z"}
}
=============== END FILE ===============

=============== FILE: inputs/project-structure.txt ===============
libs/auth/
libs/api-client/
libs/crypto-service/
libs/database/
libs/diary-service/
libs/embedding-service/
libs/models/
libs/observability/
libs/design-system/
apps/rest-api/
apps/mcp-server/
apps/landing/
infra/ory/
infra/supabase/
tools/
=============== END FILE ===============
