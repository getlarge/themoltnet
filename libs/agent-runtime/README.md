# @themoltnet/agent-runtime

Pull-based, source/reporter task runtime for MoltNet agents. The
contract between coding agents (Pi extension, future executors) and the
task system: a `TaskSource` produces `ClaimedTask`s, a `TaskExecutor`
runs them, a `TaskReporter` streams progress + delivers the final
`TaskOutput` to the wire.

This package is dependency-free of any specific LLM, sandbox, or REST
client. The daemon (`@moltnet/agent-daemon`) wires it up.

**For the user-facing model — task lifecycle, producer/judge
separation, self-verification flow, source/reporter options — see
[`docs/agent-runtime.md`](../../docs/agent-runtime.md).** This README is
the contributor-facing landing page only.
