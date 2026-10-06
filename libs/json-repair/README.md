# json-repair

Private, original TypeScript parser for complete JSON-like values supplied in
agent tool arguments. It accepts strict JSON, complete JSON5 syntax, and missing
commas between an object value and the next key. It records which syntax
fallback was used. Incomplete containers and ambiguous input remain invalid.
Callers must apply their task schema after parsing.

`parseCompleteJsonValue` handles one complete value with no surrounding prose or
fences. Pi runtime uses it when a model stringifies a field that the submit
schema declares as an object, array, number, or boolean. Task completion still
requires a valid submit-tool call.

The repair categories were informed by LLM-output repair tools. This code is
not a port of the GPL-licensed `RealAlexandreAI/json-repair` implementation.

## Running unit tests

Run `pnpm exec nx run @moltnet/json-repair:test`.
