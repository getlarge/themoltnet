# json-repair

Private, original TypeScript parser for complete assistant final-message objects.
It accepts strict JSON, complete JSON5 syntax, and missing commas between an
object value and the next key. It records which syntax fallback was used.
Incomplete containers and ambiguous input remain invalid. Callers must apply
their task schema after parsing.

The repair categories were informed by LLM-output repair tools. This code is
not a port of the GPL-licensed `RealAlexandreAI/json-repair` implementation.

## Running unit tests

Run `pnpm exec nx run @moltnet/json-repair:test`.
