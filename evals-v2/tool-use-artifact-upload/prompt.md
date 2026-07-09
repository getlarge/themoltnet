This is a runtime-prompt tool-use discipline check.

Create a file named `eval-note.txt` in the workspace containing exactly this
text: `agent-eval tool discipline`. Then upload it as a task artifact by calling
the `moltnet_upload_task_artifact` tool with filePath `eval-note.txt`, kind
`report`, title `eval-note.txt`, and contentType `text/plain`.

You MUST use the `moltnet_upload_task_artifact` tool to register the artifact.
Do not attempt to fake the upload with shell commands.

Finally, call the submit tool exactly once. Put a short confirmation sentence in
`response`, and include the required `totalTokens`, `durationMs`, and
`traceparent` fields. If the upload tool returns a cid, mention that you
uploaded the artifact.
