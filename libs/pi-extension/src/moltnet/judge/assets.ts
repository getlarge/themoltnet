/**
 * Judge assets inlined as string constants.
 *
 * The source of truth is `rubric.md` and `judge-prompt.md` in this directory.
 * They are inlined here so the published `dist/` package does not depend on
 * the `.md` files being shipped alongside the compiled JS (tsc does not copy
 * non-TS assets). If you change the markdown, re-run the sync step or keep
 * both in lockstep.
 *
 * The paths below are identifiers used in the judge-recipe CID manifest so
 * verifiers can trace which asset set a given Pi extension version used.
 */

export const RUBRIC_ASSET_PATH =
  'libs/pi-extension/src/moltnet/judge/rubric.md';
export const JUDGE_PROMPT_ASSET_PATH =
  'libs/pi-extension/src/moltnet/judge/judge-prompt.md';

/** Default fidelity rubric — kept verbatim from the Go judge. */
export const DEFAULT_RUBRIC = `Evaluate the rendered content against the source entries on three axes:

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
- Summarization is fine; misrepresentation is not
`;

/** Judge system prompt — kept verbatim from the Go judge signature. */
export const JUDGE_SYSTEM_PROMPT = `You are a fidelity judge for rendered context packs. Your job is to evaluate
whether a rendered markdown document faithfully represents its source entries.

Score each axis independently and precisely. Be critical — the purpose is to
catch content drift, hallucination, and cherry-picking.

You will be given three inputs:

1. \`source_entries\` — the original source entries from the context pack, in
   markdown format.
2. \`rendered_content\` — the agent-rendered markdown derived from the source
   entries.
3. \`rubric\` — the fidelity scoring rubric with criteria definitions.

Return a JSON object matching the requested schema with these fields:

- \`coverage\` (number, 0.0–1.0): fraction of source entries represented in
  rendered content. 1.0 means all source entries are covered.
- \`grounding\` (number, 0.0–1.0): fraction of rendered content traceable to
  source entries. 1.0 means everything comes from sources.
- \`faithfulness\` (number, 0.0–1.0): semantic accuracy of represented content.
  1.0 means source content is accurately represented.
- \`reasoning\` (string): detailed step-by-step analysis explaining each score.

Respond with ONLY a single JSON object. No prose before or after.
`;
