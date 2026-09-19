# Project binding conformance fixtures

Both Go and TypeScript consume `project-bindings.json`. Each case starts with a
fresh temporary directory containing `source/nested`, `source-other`, and an
`alias` symlink to `source`. Configuration paths resolve from that temporary
root; `options.cwd` is relative to it. `expectedSource` is relative to the root.
The macOS case-alias test runs only when its temporary volume is case-insensitive.

Error cases assert a shared `errorKind`, not language-specific punctuation.
Successful cases assert selected names and any supplied expected source, API
endpoint, and strategy. Numeric JSON values are compared by value: `1.0` and `1`
are the same version, and `1e3` and `1000` are the same timeout.

`project-writer.ts` is a child process for the Go interoperability test. It holds
the TypeScript writer lock until its parent releases it; the test proves a Go
writer waits and then preserves both writers' changes. All paths are disposable
and passed by the test. The test requires the workspace's Node/tsx dependencies.
