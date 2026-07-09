This is a runtime-prompt instruction-following check. Do NOT inspect files and
do NOT edit anything in the workspace.

List benefits of running agent evaluations across multiple models. Follow these
constraints EXACTLY:

- Output EXACTLY three bullet points. Not two, not four.
- Each bullet must start with "- " (a dash and a space).
- Do NOT include any prose before, between, or after the bullets — no
  introduction, no conclusion, no headings.

Put the three-bullet list in the `response` field and call the submit tool
exactly once with the required `totalTokens`, `durationMs`, and `traceparent`
fields.
