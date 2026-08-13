package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

const secretGuardFailure = "MoltNet secret guard could not verify this tool call. Run it outside the activated agent session after reviewing the credential exposure risk."
const maxSecretHookPayloadBytes = 8 << 20

const secretGuardPayloadTooLarge = "MoltNet secret guard rejected an oversized tool payload. Split the operation into a smaller request; credential protection was not evaluated."

type secretHookInput struct {
	ToolName  string         `json:"tool_name"`
	ToolInput map[string]any `json:"tool_input"`
}

// pathClass distinguishes credential material from managed enforcement files.
// Credential paths are confidential — no generic read or write is allowed.
// Managed config paths are integrity-sensitive — reads are allowed, but
// writes, deletions, and mutations are denied (issue #1868).
type pathClass int

const (
	pathNone          pathClass = iota
	pathCredential              // .moltnet/<agent>/moltnet.json, env, pem, …
	pathManagedConfig           // .claude/settings.json, .codex/hooks.json, …
)

func runSecretsGuardCmd(in io.Reader, out io.Writer) error {
	payload, err := io.ReadAll(io.LimitReader(in, maxSecretHookPayloadBytes+1))
	if err != nil {
		return writeSecretGuardDenial(out, secretGuardFailure)
	}
	if len(payload) > maxSecretHookPayloadBytes {
		return writeSecretGuardDenial(out, secretGuardPayloadTooLarge)
	}

	var input secretHookInput
	if err := json.NewDecoder(bytes.NewReader(payload)).Decode(&input); err != nil {
		return writeSecretGuardDenial(out, secretGuardFailure)
	}
	if input.ToolInput == nil {
		return writeSecretGuardDenial(out, secretGuardFailure)
	}

	tool := normalizeSecretToolName(input.ToolName)
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
	case "read", "write", "edit", "grep", "glob", "applypatch":
		reason = evaluateSecretsFileTool(input.ToolInput, tool)
	default:
		// Hosts add tool names faster than the guard can release. Unknown tools
		// remain allowed only when their path-bearing fields do not target a
		// protected location.
		reason = evaluateSecretsFileTool(input.ToolInput, tool)
	}
	if reason == "" {
		return nil
	}
	return writeSecretGuardDenial(out, reason)
}

func normalizeSecretToolName(tool string) string {
	tool = strings.ToLower(strings.TrimSpace(tool))
	tool = strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(tool)
	return tool
}

func writeSecretGuardDenial(out io.Writer, reason string) error {
	var result hookDenyOutput
	result.HookSpecificOutput.HookEventName = "PreToolUse"
	result.HookSpecificOutput.PermissionDecision = "deny"
	result.HookSpecificOutput.PermissionDecisionReason = reason
	return json.NewEncoder(out).Encode(result)
}

func evaluateSecretsFileTool(input map[string]any, tool string) string {
	isWriteTool := false
	switch tool {
	case "write", "edit", "applypatch":
		isWriteTool = true
	}
	for key, raw := range input {
		value, ok := raw.(string)
		if !ok {
			continue
		}
		normalizedKey := normalizeSecretToolName(key)
		switch normalizedKey {
		case "filepath", "path", "directory", "include", "glob":
			class := classifyProtectedPath(value)
			if class == pathCredential {
				return "Direct agent file-tool access to MoltNet credential material is blocked. Use activation, env check, or another non-revealing MoltNet command."
			}
			if class == pathManagedConfig && isWriteTool {
				return "Direct agent file-tool mutation of MoltNet enforcement files is blocked. Use a reviewed non-revealing MoltNet command or edit outside the activated agent session."
			}
		case "patch", "patchtext":
			if patchTouchesProtectedSecret(value) {
				return "A patch targeting MoltNet credential material is blocked. Use a reviewed non-revealing MoltNet command."
			}
		}
	}
	return ""
}

func patchTouchesProtectedSecret(patch string) bool {
	prefixes := []string{"*** Add File:", "*** Update File:", "*** Delete File:", "*** Move to:", "--- ", "+++ "}
	for _, line := range strings.Split(patch, "\n") {
		line = strings.TrimSpace(line)
		for _, prefix := range prefixes {
			if !strings.HasPrefix(line, prefix) {
				continue
			}
			path := strings.TrimSpace(strings.TrimPrefix(line, prefix))
			path = strings.TrimPrefix(strings.TrimPrefix(path, "a/"), "b/")
			if pathTouchesProtectedSecret(path) {
				return true
			}
		}
	}
	return false
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
			if static {
				switch classifyProtectedPath(target) {
				case pathCredential:
					denial = "Shell redirection involving MoltNet credential material is blocked."
					return false
				case pathManagedConfig:
					denial = "Shell redirection into MoltNet enforcement files is blocked."
					return false
				}
			} else if shellWordMentionsProtectedPath(node.Word) {
				denial = "Shell redirection involving MoltNet credential material is blocked."
				return false
			}
		case *syntax.CallExpr:
			executable, args, _, ok, argsComplete := parseShellInvocation(node, "", vars)
			if !ok {
				if callMentionsProtectedPath(node) {
					denial = "An unresolved shell invocation references MoltNet credential material. Use a statically verifiable non-revealing command."
					return false
				}
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

			// Classify each static argument by protection class (issue #1868).
			hasCredentialArg := false
			hasManagedConfigArg := false
			for _, arg := range args {
				switch classifyProtectedPath(arg) {
				case pathCredential:
					hasCredentialArg = true
				case pathManagedConfig:
					hasManagedConfigArg = true
				}
			}
			// For opaque args, any mention of a protected path fails closed —
			// we cannot determine read vs write for a dynamic argument.
			// When args are incomplete (some are non-static), also check the
			// raw words that were not captured in the static prefix.
			if !argsComplete {
				for _, word := range node.Args[1:] {
					if shellWordMentionsProtectedPath(word) {
						hasCredentialArg = true
						break
					}
				}
			}

			if !hasCredentialArg && !hasManagedConfigArg {
				// No explicit protected path — check for implicit recursive
				// traversal that could expose .moltnet/ credentials (issue #1868).
				if isRecursiveTraversalRisk(executable, args) {
					denial = "Recursive traversal from the repository root may expose MoltNet credential material under .moltnet/. Specify explicit paths that exclude .moltnet/."
					return false
				}
				return true
			}

			// Credential paths: always deny generic access (existing behavior).
			if hasCredentialArg {
				if isSecretMetadataCommand(executable, args) || isReviewedMoltnetConsumer(executable, args, allowGitHubToken) {
					return true
				}
				denial = fmt.Sprintf("%s may access protected MoltNet credential material. Use activation, env check, or another reviewed non-revealing MoltNet command.", filepath.Base(executable))
				return false
			}

			// Managed config paths: allow reads, deny mutations (issue #1868).
			if isManagedConfigReadCommand(executable, args) {
				return true
			}
			if isSecretMetadataCommand(executable, args) {
				return true
			}
			denial = fmt.Sprintf("%s may modify managed MoltNet enforcement files. Use a reviewed MoltNet command or edit outside the activated agent session.", filepath.Base(executable))
			return false
		}
		return true
	})
	return denial
}

func callMentionsProtectedPath(call *syntax.CallExpr) bool {
	for _, word := range call.Args {
		if shellWordMentionsProtectedPath(word) {
			return true
		}
	}
	return false
}

func shellWordMentionsProtectedPath(word *syntax.Word) bool {
	mentions := false
	var literals strings.Builder
	syntax.Walk(word, func(node syntax.Node) bool {
		literal, ok := node.(*syntax.Lit)
		if !ok {
			return true
		}
		literals.WriteString(literal.Value)
		value := filepath.ToSlash(literal.Value)
		if pathTouchesProtectedSecret(value) {
			mentions = true
			return false
		}
		return true
	})
	return mentions || pathTouchesProtectedSecret(literals.String())
}

func pathTouchesProtectedSecret(value string) bool {
	return classifyProtectedPath(value) != pathNone
}

// classifyProtectedPath determines the protection class of a path.
// Credential paths are confidential — no generic read or write is allowed.
// Managed config paths are integrity-sensitive — reads are allowed, but
// writes and mutations are denied. Only repo-relative managed paths are
// classified; absolute paths and paths in unrelated directories are pathNone
// (issue #1868).
func classifyProtectedPath(value string) pathClass {
	value = strings.TrimSpace(value)
	if value == "" {
		return pathNone
	}
	if strings.ContainsAny(value, "*?[") {
		matches, _ := filepath.Glob(value)
		for _, match := range matches {
			if class := classifyProtectedPath(match); class != pathNone {
				return class
			}
		}
	}
	if resolved, err := filepath.EvalSymlinks(value); err == nil && filepath.Clean(resolved) != filepath.Clean(value) {
		if class := classifyPathLexical(resolved); class != pathNone {
			return class
		}
	}
	return classifyPathLexical(value)
}

func classifyPathLexical(value string) pathClass {
	// Treat policy paths case-insensitively. This intentionally errs on the
	// side of blocking case variants on case-sensitive hosts so the same hook
	// cannot be bypassed when a repository moves to macOS or Windows.
	value = strings.ToLower(filepath.ToSlash(filepath.Clean(value)))
	if value == "." || value == "" {
		return pathNone
	}

	// Credential paths: .moltnet/<agent>/...
	if class := classifyCredentialPath(value); class != pathNone {
		return class
	}

	// Managed config paths: only repo-relative, no suffix matching (issue #1868).
	if isManagedConfigPath(value) {
		return pathManagedConfig
	}

	return pathNone
}

// classifyCredentialPath checks whether a path is inside .moltnet/ credential
// material. Returns pathCredential for confidential files, pathNone otherwise.
func classifyCredentialPath(value string) pathClass {
	marker := ".moltnet/"
	index := strings.Index(value, marker)
	if index < 0 {
		if value == ".moltnet" || strings.HasSuffix(value, "/.moltnet") {
			return pathCredential
		}
		return pathNone
	}
	rel := strings.TrimPrefix(value[index+len(marker):], "/")
	parts := strings.Split(rel, "/")
	if len(parts) == 1 && parts[0] == "default-agent" {
		return pathNone
	}
	if len(parts) < 2 {
		return pathCredential
	}
	name := parts[len(parts)-1]
	if len(parts) == 2 && name == "gitconfig" {
		return pathNone
	}
	if len(parts) == 3 && parts[1] == "ssh" && name == "id_ed25519.pub" {
		return pathNone
	}
	return pathCredential
}

// pathTouchesProtectedSecretLexical is retained for backward-compatible callers.
func pathTouchesProtectedSecretLexical(value string) bool {
	return classifyPathLexical(value) != pathNone
}

// isManagedConfigPath returns true for repo-relative managed hook/config
// paths and their repo-relative ancestors. Unlike the previous suffix-based
// matching, absolute paths, home paths, and paths in unrelated directories
// are NOT matched (issue #1868).
func isManagedConfigPath(value string) bool {
	protected := []string{
		".claude/settings.json",
		".claude/settings.local.json",
		".claude/hooks/moltnet-secret-guard.sh",
		".codex/hooks.json",
		".opencode/plugins/moltnet-secret-guard.ts",
	}
	// Only match repo-relative paths: no leading slash, no ~, and the cleaned
	// path must not escape the repo via "..".
	if strings.HasPrefix(value, "/") || strings.HasPrefix(value, "~") {
		return false
	}
	if strings.HasPrefix(value, "../") || value == ".." {
		return false
	}
	for _, protectedPath := range protected {
		if value == protectedPath {
			return true
		}
		// Ancestors of managed files (e.g. .claude, .codex) are protected from
		// deletion/mutation but only in the repo-relative form.
		for parent := filepath.ToSlash(filepath.Dir(protectedPath)); parent != "."; parent = filepath.ToSlash(filepath.Dir(parent)) {
			if value == parent {
				return true
			}
		}
	}
	return false
}

// isProtectedGuardPath is retained for backward-compatible callers.
func isProtectedGuardPath(value string) bool {
	return isManagedConfigPath(value)
}

// isManagedConfigReadCommand returns true when the command is a known
// read-only operation on a managed config file. Managed config files (e.g.
// .claude/settings.json, .codex/hooks.json) are integrity-sensitive but safe
// to inspect — reads are allowed, writes are denied (issue #1868).
func isManagedConfigReadCommand(executable string, args []string) bool {
	base := filepath.Base(executable)
	switch base {
	case "rg", "grep", "egrep", "fgrep", "ag",
		"sed", "head", "tail", "cat", "less", "more",
		"wc", "file", "du", "stat", "test", "[",
		"diff", "cmp", "strings", "xxd", "hexdump", "od",
		"nl", "cut", "tr", "expand", "unexpand",
		"ls", "find", "tree":
		return true
	case "git":
		// Only read-only git subcommands are safe for managed config paths.
		if len(args) == 0 {
			return false
		}
		switch args[0] {
		case "diff", "log", "status", "grep", "show", "blame",
			"ls-files", "ls-tree":
			return true
		}
		return false
	case "cp":
		// cp is a read when the managed config path is only in the source
		// position (first non-flag arg), not in the destination (last arg).
		if len(args) == 0 {
			return false
		}
		dest := args[len(args)-1]
		if classifyProtectedPath(dest) == pathManagedConfig {
			return false // destination is managed config → write
		}
		return true
	case "mv":
		// mv removes the source, so any managed config arg is a mutation.
		return false
	default:
		return false
	}
}

// isRecursiveTraversalRisk returns true when a command can recursively
// traverse the repository tree and potentially expose .moltnet/ credentials
// without naming the protected path explicitly (issue #1868).
func isRecursiveTraversalRisk(executable string, args []string) bool {
	base := filepath.Base(executable)
	switch base {
	case "rg", "ag":
		// rg traverses hidden files with --hidden or -H (short for --hidden
		// in ripgrep). Without --hidden, .moltnet/ is still searched because
		// it is not gitignored — but the guard checks for explicit dot targets.
		return hasDotTarget(args) && hasRecursiveFlag(args, "--hidden", "-H", "--no-ignore", "--no-ignore-vcs", "-u", "-uu", "--unrestricted")
	case "grep", "egrep", "fgrep":
		return hasDotTarget(args) && hasRecursiveFlag(args, "-R", "-r", "--recursive")
	case "find":
		// find . is inherently recursive.
		return hasDotTarget(args)
	case "tar":
		return hasDotTarget(args)
	case "zip":
		return hasDotTarget(args) && hasRecursiveFlag(args, "-r", "--recurse-paths")
	case "rsync":
		return hasDotTarget(args)
	case "cp":
		// cp -R/-r with . as source is recursive.
		return hasDotTarget(args) && hasRecursiveFlag(args, "-R", "-r", "--recursive")
	default:
		return false
	}
}

// hasDotTarget returns true if any argument is "." or "./" — the repository
// root, which contains .moltnet/.
func hasDotTarget(args []string) bool {
	for _, arg := range args {
		cleaned := filepath.ToSlash(filepath.Clean(arg))
		if cleaned == "." {
			return true
		}
	}
	return false
}

// hasRecursiveFlag checks whether any argument matches one of the given
// recursive-traversal flags.
func hasRecursiveFlag(args []string, flags ...string) bool {
	flagSet := make(map[string]bool, len(flags))
	for _, f := range flags {
		flagSet[f] = true
	}
	for _, arg := range args {
		if flagSet[arg] {
			return true
		}
		// Handle combined short flags like -RH or -rH.
		if strings.HasPrefix(arg, "-") && !strings.HasPrefix(arg, "--") && len(arg) > 2 {
			for _, ch := range arg[1:] {
				if flagSet["-"+string(ch)] {
					return true
				}
			}
		}
	}
	return false
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
		return stripMoltnetPersistentFlags(args), true
	case "npx":
		packageIndex := npxPackageIndex(args)
		if packageIndex >= 0 && args[packageIndex] == "@themoltnet/cli" {
			return stripMoltnetPersistentFlags(args[packageIndex+1:]), true
		}
	}
	return nil, false
}

func stripMoltnetPersistentFlags(args []string) []string {
	normalized := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == "--api-url" || arg == "--credentials" {
			if index+1 < len(args) {
				index++
			}
			continue
		}
		if strings.HasPrefix(arg, "--api-url=") || strings.HasPrefix(arg, "--credentials=") {
			continue
		}
		normalized = append(normalized, arg)
	}
	return normalized
}

func npxPackageIndex(args []string) int {
	optionsWithValues := map[string]bool{
		"--cache": true, "--call": true, "-c": true, "--package": true,
		"-p": true, "--script-shell": true, "--shell": true,
		"--userconfig": true, "--workspace": true, "-w": true,
	}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == "--" {
			if index+1 < len(args) {
				return index + 1
			}
			return -1
		}
		if !strings.HasPrefix(arg, "-") {
			return index
		}
		if optionsWithValues[arg] && index+1 < len(args) {
			index++
		}
	}
	return -1
}

func isReviewedMoltnetConsumer(executable string, args []string, allowGitHubToken bool) bool {
	args, ok := normalizedMoltnetArgs(executable, args)
	if !ok || len(args) == 0 || isMoltnetRevealArgs(args, allowGitHubToken) || moltnetArgsTouchNonCredentialSecret(args) {
		return false
	}
	if matchesMoltnetOperation(args,
		[]string{"agents", "whoami"},
		[]string{"agents", "lookup"},
		[]string{"agents", "activation", "validate"},
		[]string{"agents", "activation", "refresh"},
		[]string{"agents", "activation", "clear"},
		[]string{"agents", "keys", "list"},
		[]string{"agents", "keys", "revoke"},
		[]string{"env", "check"},
		[]string{"env", "configure"},
		[]string{"entry", "create"},
		[]string{"entry", "create-signed"},
		[]string{"entry", "list"},
		[]string{"entry", "get"},
		[]string{"entry", "update"},
		[]string{"entry", "delete"},
		[]string{"entry", "search"},
		[]string{"entry", "verify"},
		[]string{"entry", "commit"},
		[]string{"diary", "list"},
		[]string{"diary", "get"},
		[]string{"diary", "tags"},
		[]string{"diary", "create"},
		[]string{"diary", "transfer", "initiate"},
		[]string{"diary", "transfer", "accept"},
		[]string{"diary", "transfer", "reject"},
		[]string{"diary", "grants", "list"},
		[]string{"diary", "grants", "create"},
		[]string{"diary", "grants", "revoke"},
		[]string{"teams", "delete"},
		[]string{"teams", "list"},
		[]string{"teams", "get"},
		[]string{"teams", "members", "list"},
		[]string{"teams", "members", "remove"},
		[]string{"teams", "members", "update-role"},
		[]string{"teams", "create"},
		[]string{"teams", "join"},
		[]string{"teams", "invite", "delete"},
		[]string{"teams", "invite", "create"},
		[]string{"teams", "invite", "list"},
		[]string{"task", "list"},
		[]string{"task", "get"},
		[]string{"task", "attempts"},
		[]string{"task", "tail"},
		[]string{"task", "create"},
		[]string{"task", "continue"},
		[]string{"task", "schemas"},
		[]string{"task", "artifacts", "stage"},
		[]string{"task", "artifacts", "list"},
		[]string{"task", "artifacts", "upload"},
		[]string{"task", "artifacts", "download"},
		[]string{"task", "runtime-sessions", "list"},
		[]string{"task", "runtime-sessions", "get"},
		[]string{"task", "runtime-sessions", "upload"},
		[]string{"task", "runtime-sessions", "download"},
		[]string{"pack", "list"},
		[]string{"pack", "get"},
		[]string{"pack", "render"},
		[]string{"pack", "create"},
		[]string{"pack", "update"},
		[]string{"pack", "provenance"},
		[]string{"rendered-pack", "list"},
		[]string{"rendered-pack", "get"},
		[]string{"rendered-pack", "update"},
		[]string{"rendered-pack", "to-skill"},
		[]string{"relations", "create"},
		[]string{"relations", "list"},
		[]string{"relations", "update"},
		[]string{"relations", "delete"},
		[]string{"profile", "list"},
		[]string{"profile", "get"},
		[]string{"profile", "create"},
		[]string{"profile", "update"},
		[]string{"profile", "delete"},
		[]string{"vouch", "issue"},
		[]string{"vouch", "list"},
		[]string{"signing-requests", "create"},
		[]string{"signing-requests", "list"},
		[]string{"signing-requests", "get"},
		[]string{"signing-credentials", "list"},
		[]string{"signing-credentials", "get"},
		[]string{"signing-credentials", "approve"},
		[]string{"signing-credentials", "suspend"},
		[]string{"signing-credentials", "revoke"},
		[]string{"sign"},
		[]string{"crypto", "identity"},
		[]string{"crypto", "verify"},
		[]string{"git", "setup"},
		[]string{"config", "repair"},
		[]string{"secrets", "guard"},
	) {
		return true
	}
	return matchesMoltnetOperation(args,
		[]string{"github", "setup"},
		[]string{"github", "guard"},
	) || (allowGitHubToken && matchesMoltnetOperation(args, []string{"github", "token"}))
}

func moltnetArgsTouchNonCredentialSecret(args []string) bool {
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == "--credentials" && index+1 < len(args) {
			index++
			continue
		}
		if strings.HasPrefix(arg, "--credentials=") {
			continue
		}
		if pathTouchesProtectedSecret(arg) {
			return true
		}
	}
	return false
}

func matchesMoltnetOperation(args []string, operations ...[]string) bool {
	for _, operation := range operations {
		if len(args) < len(operation) {
			continue
		}
		matched := true
		for index, part := range operation {
			if args[index] != part {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}
	return false
}

func isMoltnetRevealCommand(executable string, args []string, allowGitHubToken bool) bool {
	args, ok := normalizedMoltnetArgs(executable, args)
	return ok && isMoltnetRevealArgs(args, allowGitHubToken)
}

func isMoltnetRevealArgs(args []string, allowGitHubToken bool) bool {
	if len(args) > 0 && args[0] == "register" {
		return true
	}
	if len(args) >= 3 && args[0] == "agents" && args[1] == "keys" && (args[2] == "create" || args[2] == "rotate") {
		return true
	}
	if len(args) >= 3 && args[0] == "agents" && args[1] == "credentials" && args[2] == "rotate" {
		return true
	}
	if len(args) >= 2 && args[0] == "config" && args[1] == "export-env" {
		return true
	}
	if len(args) >= 2 && args[0] == "github" && args[1] == "credential-helper" {
		return true
	}
	if len(args) > 0 && args[0] == "ssh-key" {
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
		executable, _, _, ok, _ := parseShellInvocation(outer, "", vars)
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
	executable, args, _, ok, _ := parseShellInvocation(call, "", vars)
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
