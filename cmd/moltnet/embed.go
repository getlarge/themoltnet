package main

import _ "embed"

//go:embed embed/templates/task.toml
var taskTomlTemplate []byte

//go:embed embed/templates/Dockerfile
var dockerfileTemplate []byte

//go:embed embed/templates/test.sh
var testShTemplate []byte

//go:embed embed/judge/judge.js
var judgeJS []byte

//go:embed embed/judge/package.json
var judgePackageJSON []byte

//go:embed embed/agents/claude_code_moltnet.py
var agentPython []byte
