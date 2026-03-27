package main

import "strings"

// x-release-please-start-version
var version = "0.1.0"

// x-release-please-end

var commit string

// deriveMCPURL converts an API URL to the corresponding MCP URL.
// e.g. "https://api.themolt.net" → "https://mcp.themolt.net/mcp"
func deriveMCPURL(apiURL string) string {
	return strings.Replace(apiURL, "://api.", "://mcp.", 1) + "/mcp"
}

func main() {
	SetVersionInfo(version, commit)
	Execute()
}
