package main

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

const secretGuardFailure = "MoltNet secret guard could not verify this tool call. Run it outside the activated agent session after reviewing the credential exposure risk."

type secretHookInput struct {
	ToolName  string         `json:"tool_name"`
	ToolInput map[string]any `json:"tool_input"`
}

func runSecretsGuardCmd(in io.Reader, out io.Writer) error {
	var input secretHookInput
	if err := json.NewDecoder(io.LimitReader(in, 1<<20)).Decode(&input); err != nil {
		return writeSecretGuardDenial(out, secretGuardFailure)
	}
	if input.ToolInput == nil {
		return writeSecretGuardDenial(out, secretGuardFailure)
	}

	tool := strings.ToLower(strings.TrimSpace(input.ToolName))
	if tool == "" {
		if _, ok := input.ToolInput["command"]; ok {
			tool = "bash"
		}
	}
	var reason string
	switch tool {
	case "bash", "shell", "terminal":
		command, ok := input.ToolInput["command"].(string)
		if !ok || strings.TrimSpace(command) == "" {
			reason = secretGuardFailure
		} else {
			reason = evaluateSecretsShell(command)
		}
	case "read", "write", "edit", "grep", "glob":
		reason = evaluateSecretsFileTool(input.ToolInput)
	default:
		// Unknown tool kinds have no normalized filesystem or command surface.
		// Let the host's own permission system decide them.
		return nil
	}
	if reason == "" {
		return nil
	}
	return writeSecretGuardDenial(out, reason)
}

func writeSecretGuardDenial(out io.Writer, reason string) error {
	var result hookDenyOutput
	result.HookSpecificOutput.HookEventName = "PreToolUse"
	result.HookSpecificOutput.PermissionDecision = "deny"
	result.HookSpecificOutput.PermissionDecisionReason = reason
	return json.NewEncoder(out).Encode(result)
}

func evaluateSecretsFileTool(input map[string]any) string {
	for _, key := range []string{"file_path", "path", "directory", "include", "glob"} {
		value, ok := input[key].(string)
		if ok && pathTouchesProtectedSecret(value) {
			return "Direct agent file-tool access to MoltNet credential material is blocked. Use activation, env check, or another non-revealing MoltNet command."
		}
	}
	return ""
}

func evaluateSecretsShell(command string) string {
	file, err := syntax.NewParser(syntax.Variant(syntax.LangBash)).Parse(strings.NewReader(command), "secret-hook")
	if err != nil {
		return secretGuardFailure
	}
	vars := collectStaticShellVars(file)
	scopedGitHubTokenCalls := collectScopedGitHubTokenCalls(file, vars)
	denial := ""
	syntax.Walk(file, func(node syntax.Node) bool {
		if denial != "" || node == nil {
			return denial == ""
		}
		switch node := node.(type) {
		case *syntax.Redirect:
			target, static := staticShellWord(node.Word, vars)
			if (static && pathTouchesProtectedSecret(target)) || (!static && shellWordMentionsProtectedPath(node.Word)) {
				denial = "Shell redirection involving MoltNet credential material is blocked."
				return false
			}
		case *syntax.CallExpr:
			executable, args, _, ok := parseShellInvocation(node, "", vars)
			if !ok {
				return true
			}
			if isKeyringRevealCommand(executable, args) {
				denial = "Direct OS credential-store reads are blocked in activated agent sessions. Use a non-revealing MoltNet consumer."
				return false
			}
			allowGitHubToken := scopedGitHubTokenCalls[node]
			if isMoltnetRevealCommand(executable, args, allowGitHubToken) {
				denial = "Commands that reveal or export credentials are blocked in activated agent sessions. Run the explicit command from a human-controlled terminal."
				return false
			}
			touches := false
			for _, arg := range args {
				if pathTouchesProtectedSecret(arg) {
					touches = true
					break
				}
			}
			if args == nil {
				for _, word := range node.Args[1:] {
					if shellWordMentionsProtectedPath(word) {
						touches = true
						break
					}
				}
			}
			if !touches {
				return true
			}
			if isSecretMetadataCommand(executable, args) || isReviewedMoltnetConsumer(executable, args, allowGitHubToken) {
				return true
			}
			denial = fmt.Sprintf("%s may access protected MoltNet credential material. Use activation, env check, or another reviewed non-revealing MoltNet command.", filepath.Base(executable))
			return false
		}
		return true
	})
	return denial
}

func shellWordMentionsProtectedPath(word *syntax.Word) bool {
	mentions := false
	syntax.Walk(word, func(node syntax.Node) bool {
		literal, ok := node.(*syntax.Lit)
		if !ok {
			return true
		}
		value := filepath.ToSlash(literal.Value)
		if strings.Contains(value, ".moltnet/") || strings.Contains(value, ".claude/settings.local.json") {
			mentions = true
			return false
		}
		return true
	})
	return mentions
}

func pathTouchesProtectedSecret(value string) bool {
	value = filepath.ToSlash(filepath.Clean(strings.TrimSpace(value)))
	if value == "." || value == "" {
		return false
	}
	if strings.Contains(value, "/.claude/settings.local.json") || value == ".claude/settings.local.json" {
		return true
	}
	marker := ".moltnet/"
	index := strings.Index(value, marker)
	if index < 0 {
		return value == ".moltnet" || strings.HasSuffix(value, "/.moltnet")
	}
	rel := strings.TrimPrefix(value[index+len(marker):], "/")
	parts := strings.Split(rel, "/")
	if len(parts) < 2 {
		return true
	}
	name := parts[len(parts)-1]
	if name == "default-agent" || name == "activation-cache.json" || name == "gitconfig" || strings.HasSuffix(name, ".pub") {
		return false
	}
	return true
}

func isSecretMetadataCommand(executable string, args []string) bool {
	switch filepath.Base(executable) {
	case "stat":
		return true
	case "test", "[":
		for _, arg := range args {
			if arg == "-f" || arg == "-d" || arg == "-e" || arg == "]" {
				continue
			}
			if !pathTouchesProtectedSecret(arg) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func normalizedMoltnetArgs(executable string, args []string) ([]string, bool) {
	switch filepath.Base(executable) {
	case "moltnet":
		return args, true
	case "npx":
		if len(args) > 0 && args[0] == "@themoltnet/cli" {
			return args[1:], true
		}
	}
	return nil, false
}

func isReviewedMoltnetConsumer(executable string, args []string, allowGitHubToken bool) bool {
	args, ok := normalizedMoltnetArgs(executable, args)
	if !ok || len(args) == 0 || isMoltnetRevealArgs(args, allowGitHubToken) {
		return false
	}
	switch args[0] {
	case "agents", "env", "entry", "diary", "teams", "task", "pack", "rendered-pack", "relations", "profile", "vouch", "sign", "crypto", "git", "ssh-key", "secrets":
		return true
	case "github":
		return len(args) > 1 && (args[1] == "guard" || args[1] == "credential-helper" || (args[1] == "token" && allowGitHubToken))
	default:
		return false
	}
}

func isMoltnetRevealCommand(executable string, args []string, allowGitHubToken bool) bool {
	args, ok := normalizedMoltnetArgs(executable, args)
	return ok && isMoltnetRevealArgs(args, allowGitHubToken)
}

func isMoltnetRevealArgs(args []string, allowGitHubToken bool) bool {
	if len(args) >= 2 && args[0] == "config" && args[1] == "export-env" {
		return true
	}
	if len(args) >= 2 && args[0] == "github" && args[1] == "token" && !allowGitHubToken {
		return true
	}
	if len(args) > 0 && args[0] == "decrypt" {
		return true
	}
	for _, arg := range args {
		if arg == "--show-secret" || arg == "--no-update" {
			return true
		}
	}
	return false
}

// collectScopedGitHubTokenCalls returns only token subprocess AST nodes that
// are directly assigned to GH_TOKEN on the same gh invocation. A file-wide or
// statement-wide exception would let an unrelated bare token command leak.
func collectScopedGitHubTokenCalls(file *syntax.File, vars map[string]string) map[*syntax.CallExpr]bool {
	allowed := map[*syntax.CallExpr]bool{}
	syntax.Walk(file, func(node syntax.Node) bool {
		outer, ok := node.(*syntax.CallExpr)
		if !ok {
			return true
		}
		executable, _, _, ok := parseShellInvocation(outer, "", vars)
		if !ok || filepath.Base(executable) != "gh" {
			return true
		}
		for _, assign := range outer.Assigns {
			if assign.Name == nil || assign.Name.Value != "GH_TOKEN" {
				continue
			}
			if tokenCall := githubTokenSubstitutionCall(assign.Value, vars); tokenCall != nil {
				allowed[tokenCall] = true
			}
		}
		return true
	})
	return allowed
}

func githubTokenSubstitutionCall(word *syntax.Word, vars map[string]string) *syntax.CallExpr {
	if word == nil {
		return nil
	}
	parts := word.Parts
	if len(parts) == 1 {
		if quoted, ok := parts[0].(*syntax.DblQuoted); ok {
			parts = quoted.Parts
		}
	}
	if len(parts) != 1 {
		return nil
	}
	substitution, ok := parts[0].(*syntax.CmdSubst)
	if !ok || len(substitution.Stmts) != 1 {
		return nil
	}
	call, ok := substitution.Stmts[0].Cmd.(*syntax.CallExpr)
	if !ok {
		return nil
	}
	executable, args, _, ok := parseShellInvocation(call, "", vars)
	if !ok {
		return nil
	}
	args, ok = normalizedMoltnetArgs(executable, args)
	if !ok || len(args) < 2 || args[0] != "github" || args[1] != "token" {
		return nil
	}
	return call
}

func isKeyringRevealCommand(executable string, args []string) bool {
	base := strings.ToLower(filepath.Base(executable))
	switch base {
	case "secret-tool":
		return len(args) > 0 && args[0] == "lookup"
	case "security":
		return len(args) > 0 && args[0] == "find-generic-password"
	case "powershell", "powershell.exe", "pwsh", "pwsh.exe":
		joined := strings.ToLower(strings.Join(args, " "))
		return strings.Contains(joined, "passwordvault") || strings.Contains(joined, "credentialmanager")
	default:
		return false
	}
}
