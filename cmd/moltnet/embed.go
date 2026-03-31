package main

import (
	_ "embed"
	"text/template"
)

//go:embed embed/templates/task.toml.tmpl
var taskTomlTmplSrc string

//go:embed embed/templates/test.sh.tmpl
var testShTmplSrc string

//go:embed embed/templates/Dockerfile
var dockerfileTemplate []byte

//go:embed embed/judge/judge.js
var judgeJS []byte

//go:embed embed/judge/package.json
var judgePackageJSON []byte

//go:embed embed/agents/claude_code_moltnet.py
var agentPython []byte

var (
	taskTomlTmpl = template.Must(template.New("task.toml").Parse(taskTomlTmplSrc))
	testShTmpl   = template.Must(template.New("test.sh").Parse(testShTmplSrc))
)
