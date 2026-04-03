package main

import (
	_ "embed"
	"text/template"
)

//go:embed embed/templates/task.toml.tmpl
var taskTomlTmplSrc string

//go:embed embed/templates/test.sh.tmpl
var testShTmplSrc string

//go:embed embed/templates/Dockerfile.claude
var dockerfileClaudeTemplate []byte

//go:embed embed/templates/Dockerfile.codex
var dockerfileCodexTemplate []byte

//go:embed embed/judge/retry.js
var judgeRetryJS []byte

//go:embed embed/judge/judge.js
var judgeJS []byte

//go:embed embed/judge/judge-codex.js
var judgeCodexJS []byte

//go:embed embed/judge/package.json
var judgePackageJSON []byte

//go:embed embed/agents/claude_code_moltnet.py
var agentPython []byte

//go:embed embed/agents/headless_prompt.py
var agentPromptPython []byte

//go:embed embed/agents/codex_moltnet.py
var agentCodexPython []byte

//go:embed embed/agents/retry.py
var agentRetryPython []byte

var (
	taskTomlTmpl = template.Must(template.New("task.toml").Parse(taskTomlTmplSrc))
	testShTmpl   = template.Must(template.New("test.sh").Parse(testShTmplSrc))
)
