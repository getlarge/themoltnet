package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/parser"
	"mvdan.cc/sh/v3/syntax"
)

const (
	githubGuardPermissionTimeout = 2 * time.Second
	githubGuardNegativeCacheTTL  = 30 * time.Second
	githubGuardGitTimeout        = 500 * time.Millisecond
)

type hookInput struct {
	ToolInput struct {
		Command string `json:"command"`
	} `json:"tool_input"`
}

type hookDenyOutput struct {
	HookSpecificOutput struct {
		HookEventName            string `json:"hookEventName"`
		PermissionDecision       string `json:"permissionDecision"`
		PermissionDecisionReason string `json:"permissionDecisionReason"`
	} `json:"hookSpecificOutput"`
}

type githubGuardContext struct {
	CredentialsPath string
	AuthorshipMode  string
	Strict          bool
}

type guardPermissionLoader func(context.Context, string) (map[string]string, error)

type ghOperationKind uint8

const (
	ghUnknown ghOperationKind = iota
	ghReadOnly
	ghWrite
)

type ghOperation struct {
	Kind         ghOperationKind
	Permission   string
	HumanVisible bool
	Description  string
}

type guardVerdict struct {
	Allow  bool
	Reason string
}

type guardEvaluationState struct {
	InheritedTokenUses      int
	InheritedTokenExhausted bool
}

// runGitHubGuardCmd implements the hook contract. Internal failures allow
// silently by default; MOLTNET_GITHUB_GUARD_STRICT=1 makes them deny instead.
func runGitHubGuardCmd(in io.Reader, out io.Writer) error {
	return runGitHubGuard(in, out, currentGitHubGuardContext, loadGitHubGuardPermissions)
}

func runGitHubGuard(
	in io.Reader,
	out io.Writer,
	resolveContext func() (githubGuardContext, bool),
	permissions guardPermissionLoader,
) error {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("MOLTNET_GITHUB_GUARD")), "off") {
		return nil
	}

	var input hookInput
	if err := json.NewDecoder(io.LimitReader(in, 1<<20)).Decode(&input); err != nil || input.ToolInput.Command == "" {
		return nil
	}

	guardCtx, ok := resolveContext()
	if !ok {
		return nil
	}

	reason := evaluateGitHubGuard(input.ToolInput.Command, guardCtx, permissions)
	if reason == "" {
		return nil
	}

	var result hookDenyOutput
	result.HookSpecificOutput.HookEventName = "PreToolUse"
	result.HookSpecificOutput.PermissionDecision = "deny"
	result.HookSpecificOutput.PermissionDecisionReason = reason
	return json.NewEncoder(out).Encode(result)
}

func currentGitHubGuardContext() (githubGuardContext, bool) {
	configured := strings.TrimSpace(os.Getenv("GIT_CONFIG_GLOBAL"))
	if !isMoltnetGitConfig(configured) {
		return githubGuardContext{}, false
	}

	gitConfigPath := configured
	if !filepath.IsAbs(gitConfigPath) {
		ctx, cancel := context.WithTimeout(context.Background(), githubGuardGitTimeout)
		defer cancel()
		cmd := exec.CommandContext(ctx, "git", "rev-parse", "--show-toplevel")
		cmd.Stderr = io.Discard
		root, err := cmd.Output()
		if err != nil {
			return githubGuardContext{}, false
		}
		gitConfigPath = filepath.Join(strings.TrimSpace(string(root)), gitConfigPath)
	}
	gitConfigPath = filepath.Clean(gitConfigPath)
	if !isMoltnetGitConfig(gitConfigPath) {
		return githubGuardContext{}, false
	}

	authorshipMode := strings.TrimSpace(os.Getenv("MOLTNET_COMMIT_AUTHORSHIP"))
	if authorshipMode == "" {
		if vars, err := parseEnvFile(filepath.Join(filepath.Dir(gitConfigPath), "env")); err == nil {
			authorshipMode = strings.TrimSpace(vars["MOLTNET_COMMIT_AUTHORSHIP"])
		}
	}
	if authorshipMode == "" {
		authorshipMode = "agent"
	}

	return githubGuardContext{
		CredentialsPath: filepath.Join(filepath.Dir(gitConfigPath), "moltnet.json"),
		AuthorshipMode:  authorshipMode,
		Strict:          envEnabled("MOLTNET_GITHUB_GUARD_STRICT"),
	}, true
}

func envEnabled(name string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func isMoltnetGitConfig(path string) bool {
	path = strings.ReplaceAll(filepath.ToSlash(strings.TrimSpace(path)), `\`, "/")
	path = strings.TrimSuffix(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 3 {
		return false
	}
	n := len(parts)
	return parts[n-3] == ".moltnet" && parts[n-2] != "" && parts[n-1] == "gitconfig"
}

func loadGitHubGuardPermissions(ctx context.Context, credentialsPath string) (map[string]string, error) {
	creds, err := loadCredentials(credentialsPath)
	if err != nil {
		return nil, err
	}
	if creds.GitHub == nil {
		return nil, fmt.Errorf("GitHub App not configured")
	}

	details, err := getCachedInstallationTokenDetailsWithFailureTTL(
		ctx,
		&http.Client{Timeout: githubGuardPermissionTimeout},
		creds.GitHub.AppID,
		creds.GitHub.PrivateKeyPath,
		creds.GitHub.InstallationID,
		githubGuardNegativeCacheTTL,
	)
	if err != nil {
		return nil, err
	}
	return details.Permissions, nil
}

func evaluateGitHubGuard(command string, guardCtx githubGuardContext, permissions guardPermissionLoader) string {
	return evaluateGitHubGuardScript(
		command,
		guardCtx,
		permissions,
		&guardEvaluationState{},
		0,
	)
}

func evaluateGitHubGuardScript(
	command string,
	guardCtx githubGuardContext,
	permissions guardPermissionLoader,
	state *guardEvaluationState,
	depth int,
) string {
	file, err := syntax.NewParser(syntax.Variant(syntax.LangBash)).Parse(strings.NewReader(command), "hook")
	if err != nil {
		return ""
	}

	var denial string
	syntax.Walk(file, func(node syntax.Node) bool {
		if denial != "" || node == nil {
			return denial == ""
		}
		call, ok := node.(*syntax.CallExpr)
		if !ok {
			return true
		}

		executable, args, scopedToken, ok := parseShellInvocation(call)
		if !ok {
			return true
		}
		nested, isNested, verifiable := nestedShellScript(executable, args)
		if isNested && !verifiable {
			denial = "Cannot verify a dynamic nested shell command. Use a literal shell command or run it outside the activated MoltNet agent context."
			return false
		}
		if isNested {
			if depth >= 8 {
				denial = "Nested shell command is too deep for the GitHub authorship guard to verify."
				return false
			}
			nestedState := state
			if scopedToken {
				nestedState = &guardEvaluationState{InheritedTokenUses: 1}
			}
			denial = evaluateGitHubGuardScript(
				nested,
				guardCtx,
				permissions,
				nestedState,
				depth+1,
			)
			return denial == ""
		}
		if isKnownPrefixRunner(executable) && args == nil {
			denial = "Cannot verify a dynamic command passed through a shell prefix runner."
			return false
		}
		if filepath.Base(executable) != "gh" {
			return true
		}

		op := ghOperation{Kind: ghUnknown}
		if args != nil {
			op = classifyGitHubOperation(args)
		}
		verdict := decideGitHubCall(
			op,
			scopedToken,
			state,
			guardCtx,
			permissions,
		)
		if verdict.Allow {
			return true
		}
		denial = verdict.Reason
		return false
	})
	return denial
}

func decideGitHubCall(
	op ghOperation,
	scopedToken bool,
	state *guardEvaluationState,
	guardCtx githubGuardContext,
	permissions guardPermissionLoader,
) guardVerdict {
	if op.Kind == ghReadOnly {
		return guardVerdict{Allow: true}
	}
	if op.Kind == ghUnknown {
		return guardVerdict{
			Reason: "Cannot prove this gh command is read-only or map it to a supported GitHub operation. Use a recognized gh operation, or run the command outside the activated MoltNet agent context.",
		}
	}

	hasAgentToken := scopedToken
	if !hasAgentToken && state.InheritedTokenUses > 0 {
		state.InheritedTokenUses--
		state.InheritedTokenExhausted = true
		hasAgentToken = true
	}
	if hasAgentToken {
		return guardVerdict{Allow: true}
	}
	if state.InheritedTokenExhausted {
		return guardVerdict{
			Reason: "A GH_TOKEN assigned to a nested shell may authorize only one gh write. Scope a fresh MoltNet token directly to each additional gh command.",
		}
	}
	if op.HumanVisible && guardCtx.AuthorshipMode == "human" {
		return guardVerdict{Allow: true}
	}
	if op.Permission == "" {
		return guardVerdict{
			Reason: "This GitHub write cannot be mapped to a specific installation permission. Retry with a command-scoped GH_TOKEN minted by `moltnet github token`.",
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), githubGuardPermissionTimeout)
	granted, loadErr := permissions(ctx, guardCtx.CredentialsPath)
	cancel()
	if loadErr != nil {
		if guardCtx.Strict {
			return guardVerdict{
				Reason: "GitHub App permissions are unavailable and strict guard mode is enabled. Retry after restoring credentials or network access.",
			}
		}
		return guardVerdict{Allow: true}
	}
	if !permissionAllowsWrite(granted[op.Permission]) {
		return guardVerdict{Allow: true}
	}

	description := op.Description
	if description == "" {
		description = "GitHub write"
	}
	return guardVerdict{
		Reason: fmt.Sprintf(
			"%s must be attributed to the active MoltNet GitHub App (%s:write). Retry with `GH_TOKEN=$(moltnet github token --credentials %q) gh ...` on this same command.",
			description,
			op.Permission,
			guardCtx.CredentialsPath,
		),
	}
}

func nestedShellScript(executable string, args []string) (string, bool, bool) {
	base := filepath.Base(executable)
	if base != "eval" && base != "sh" && base != "bash" && base != "dash" && base != "zsh" {
		return "", false, false
	}
	if args == nil {
		return "", true, false
	}
	if base == "eval" {
		if len(args) == 0 {
			return "", false, false
		}
		return strings.Join(args, " "), true, true
	}
	for i, arg := range args {
		if arg == "--" {
			continue
		}
		if arg == "--command" || (strings.HasPrefix(arg, "-") && strings.Contains(strings.TrimPrefix(arg, "-"), "c")) {
			if i+1 < len(args) {
				return args[i+1], true, true
			}
			return "", true, false
		}
	}
	return "", false, false
}

func permissionAllowsWrite(level string) bool {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "write", "admin":
		return true
	default:
		return false
	}
}

func parseShellInvocation(call *syntax.CallExpr) (string, []string, bool, bool) {
	scopedToken := false
	for _, assign := range call.Assigns {
		if assign.Name != nil && assign.Name.Value == "GH_TOKEN" && isMoltnetTokenWord(assign.Value) {
			scopedToken = true
		}
	}

	words := call.Args
	for len(words) > 0 {
		executable, ok := staticShellWord(words[0])
		if !ok {
			return "", nil, false, false
		}
		switch filepath.Base(executable) {
		case "command":
			words = words[1:]
			for len(words) > 0 {
				arg, literal := staticShellWord(words[0])
				if !literal || !strings.HasPrefix(arg, "-") {
					break
				}
				words = words[1:]
			}
			continue
		case "env":
			words = words[1:]
			for len(words) > 0 {
				if name, value, assignment := shellAssignmentWord(words[0]); assignment {
					if name == "GH_TOKEN" && isMoltnetTokenParts(value) {
						scopedToken = true
					}
					words = words[1:]
					continue
				}
				arg, literal := staticShellWord(words[0])
				if !literal {
					return "", nil, false, false
				}
				if arg == "--" {
					words = words[1:]
					break
				}
				if arg == "-u" || arg == "--unset" {
					if len(words) < 2 {
						return "", nil, false, false
					}
					words = words[2:]
					continue
				}
				if strings.HasPrefix(arg, "-") {
					words = words[1:]
					continue
				}
				break
			}
			continue
		}
		break
	}

	if len(words) == 0 {
		return "", nil, false, false
	}
	executable, ok := staticShellWord(words[0])
	if !ok {
		return "", nil, false, false
	}
	args := make([]string, 0, len(words)-1)
	for _, word := range words[1:] {
		arg, literal := staticShellWord(word)
		if !literal {
			return executable, nil, scopedToken, true
		}
		args = append(args, arg)
	}
	for isKnownPrefixRunner(executable) {
		var unwrapped bool
		executable, args, unwrapped = unwrapPrefixRunner(executable, args)
		if !unwrapped {
			return executable, nil, scopedToken, true
		}
	}
	return executable, args, scopedToken, true
}

func isKnownPrefixRunner(executable string) bool {
	switch filepath.Base(executable) {
	case "nohup", "sudo", "timeout", "xargs":
		return true
	default:
		return false
	}
}

func unwrapPrefixRunner(executable string, args []string) (string, []string, bool) {
	if args == nil {
		return executable, nil, false
	}
	switch filepath.Base(executable) {
	case "nohup":
		if len(args) > 0 && args[0] == "--" {
			args = args[1:]
		}
		return commandFromArgs(executable, args)
	case "sudo":
		commandIndex, ok := commandAfterOptions(args, map[string]bool{
			"-C": true, "--close-from": true,
			"-g": true, "--group": true,
			"-h": true, "--host": true,
			"-p": true, "--prompt": true,
			"-r": true, "--role": true,
			"-t": true, "--type": true,
			"-T": true, "--command-timeout": true,
			"-u": true, "--user": true,
		}, map[string]bool{
			"-A": true, "--askpass": true,
			"-b": true, "--background": true,
			"-E": true, "--preserve-env": true,
			"-H": true, "--set-home": true,
			"-K": true, "--remove-timestamp": true,
			"-k": true, "--reset-timestamp": true,
			"-n": true, "--non-interactive": true,
			"-S": true, "--stdin": true,
			"-V": true, "--version": true,
			"-v": true, "--validate": true,
		})
		if !ok {
			return executable, nil, false
		}
		return commandFromArgs(executable, args[commandIndex:])
	case "timeout":
		durationIndex, ok := commandAfterOptions(args, map[string]bool{
			"-k": true, "--kill-after": true,
			"-s": true, "--signal": true,
		}, map[string]bool{
			"--foreground":      true,
			"--preserve-status": true,
			"-v":                true, "--verbose": true,
		})
		if !ok || durationIndex+1 >= len(args) {
			return executable, nil, false
		}
		return commandFromArgs(executable, args[durationIndex+1:])
	case "xargs":
		commandIndex, ok := commandAfterOptions(args, map[string]bool{
			"-a": true, "--arg-file": true,
			"-d": true, "--delimiter": true,
			"-E": true, "-e": true, "--eof": true,
			"-I": true, "-i": true, "--replace": true,
			"-L": true, "-l": true, "--max-lines": true,
			"-n": true, "--max-args": true,
			"-P": true, "--max-procs": true,
			"-s": true, "--max-chars": true,
		}, map[string]bool{
			"-0": true, "--null": true,
			"-o": true, "--open-tty": true,
			"-p": true, "--interactive": true,
			"-r": true, "--no-run-if-empty": true,
			"-t": true, "--verbose": true,
			"-x": true, "--exit": true,
			"--show-limits": true,
		})
		if !ok {
			return executable, nil, false
		}
		return commandFromArgs(executable, args[commandIndex:])
	default:
		return executable, args, false
	}
}

func commandAfterOptions(args []string, valueOptions, booleanOptions map[string]bool) (int, bool) {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			return i + 1, i+1 < len(args)
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			return i, true
		}
		name := arg
		if before, _, found := strings.Cut(arg, "="); found {
			name = before
		}
		if valueOptions[name] {
			if strings.Contains(arg, "=") {
				continue
			}
			if len(name) == 2 && len(arg) > 2 {
				continue
			}
			i++
			if i >= len(args) {
				return 0, false
			}
			continue
		}
		if !booleanOptions[name] {
			return 0, false
		}
	}
	return 0, false
}

func commandFromArgs(original string, args []string) (string, []string, bool) {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") {
		return original, nil, false
	}
	return args[0], args[1:], true
}

func staticShellWord(word *syntax.Word) (string, bool) {
	if word == nil {
		return "", false
	}
	return staticShellParts(word.Parts)
}

func staticShellParts(parts []syntax.WordPart) (string, bool) {
	var value strings.Builder
	for _, part := range parts {
		switch part := part.(type) {
		case *syntax.Lit:
			value.WriteString(part.Value)
		case *syntax.SglQuoted:
			value.WriteString(part.Value)
		case *syntax.DblQuoted:
			quoted, ok := staticShellParts(part.Parts)
			if !ok {
				return "", false
			}
			value.WriteString(quoted)
		default:
			return "", false
		}
	}
	return value.String(), true
}

func shellAssignmentWord(word *syntax.Word) (string, []syntax.WordPart, bool) {
	if word == nil || len(word.Parts) == 0 {
		return "", nil, false
	}
	literal, ok := word.Parts[0].(*syntax.Lit)
	if !ok {
		return "", nil, false
	}
	name, prefix, found := strings.Cut(literal.Value, "=")
	if !found || !syntax.ValidName(name) {
		return "", nil, false
	}
	parts := append([]syntax.WordPart(nil), word.Parts...)
	if prefix == "" {
		parts = parts[1:]
	} else {
		parts[0] = &syntax.Lit{Value: prefix}
	}
	return name, parts, true
}

func isMoltnetTokenWord(word *syntax.Word) bool {
	if word == nil {
		return false
	}
	return isMoltnetTokenParts(word.Parts)
}

func isMoltnetTokenParts(parts []syntax.WordPart) bool {
	if len(parts) == 1 {
		if quoted, ok := parts[0].(*syntax.DblQuoted); ok {
			parts = quoted.Parts
		}
	}
	if len(parts) != 1 {
		return false
	}
	substitution, ok := parts[0].(*syntax.CmdSubst)
	if !ok || len(substitution.Stmts) != 1 {
		return false
	}
	stmt := substitution.Stmts[0]
	if stmt.Negated || stmt.Background || stmt.Coprocess || len(stmt.Redirs) != 0 {
		return false
	}
	call, ok := stmt.Cmd.(*syntax.CallExpr)
	if !ok || len(call.Assigns) != 0 {
		return false
	}
	executable, args, _, ok := parseShellInvocation(call)
	if !ok {
		return false
	}
	switch filepath.Base(executable) {
	case "moltnet":
		return len(args) >= 2 && args[0] == "github" && args[1] == "token"
	case "npx":
		return len(args) >= 3 && args[0] == "@themoltnet/cli" && args[1] == "github" && args[2] == "token"
	default:
		return false
	}
}

// classifyGitHubOperation's command taxonomy was audited against gh 2.95.0.
// Unknown future commands deny so CLI drift cannot silently add a write path.
func classifyGitHubOperation(args []string) ghOperation {
	args, rootHelp, ok := stripGitHubGlobalFlags(args)
	if !ok {
		return ghOperation{Kind: ghUnknown}
	}
	if rootHelp || len(args) == 0 {
		return ghOperation{Kind: ghReadOnly}
	}

	args = normalizeGitHubAlias(args)
	top := args[0]
	if len(args) == 2 && (args[1] == "--help" || args[1] == "-h") {
		return ghOperation{Kind: ghReadOnly}
	}

	switch top {
	case "auth":
		return classifySubcommand(args, map[string]bool{
			"status": true,
			"token":  true,
		})
	case "alias":
		return classifySubcommand(args, map[string]bool{"list": true})
	case "config":
		return classifySubcommand(args, map[string]bool{
			"get":  true,
			"list": true,
		})
	}

	switch top {
	case "api":
		return classifyGitHubAPI(args[1:])
	case "browse", "completion", "licenses", "search", "status", "help":
		return ghOperation{Kind: ghReadOnly}
	case "attestation", "org", "ruleset":
		return classifySubcommand(args, map[string]bool{
			"download": true, "trusted-root": true, "verify": true,
			"list": true, "check": true, "view": true,
		})
	case "pr":
		return classifyReadWriteSubcommand(args,
			[]string{"checkout", "checks", "diff", "list", "status", "view"},
			[]string{"close", "comment", "create", "edit", "lock", "merge", "ready", "reopen", "revert", "review", "unlock", "update-branch"},
			"pull_requests", true, "Pull request write")
	case "issue":
		return classifyReadWriteSubcommand(args,
			[]string{"list", "status", "view"},
			[]string{"close", "comment", "create", "delete", "develop", "edit", "lock", "pin", "reopen", "transfer", "unlock", "unpin"},
			"issues", true, "Issue write")
	case "label":
		return classifyReadWriteSubcommand(args, []string{"list"}, []string{"clone", "create", "delete", "edit"}, "issues", false, "Label write")
	case "release":
		return classifyReadWriteSubcommand(args,
			[]string{"download", "list", "verify", "verify-asset", "view"},
			[]string{"create", "delete", "delete-asset", "edit", "upload"},
			"contents", false, "Release write")
	case "repo":
		return classifyRepositoryCommand(args[1:])
	case "cache":
		return classifyReadWriteSubcommand(args, []string{"list"}, []string{"delete"}, "actions", false, "Actions cache write")
	case "run":
		return classifyReadWriteSubcommand(args, []string{"download", "list", "view", "watch"}, []string{"cancel", "delete", "rerun"}, "actions", false, "Workflow run write")
	case "workflow":
		return classifyReadWriteSubcommand(args, []string{"list", "view"}, []string{"disable", "enable", "run"}, "actions", false, "Workflow write")
	case "secret":
		return classifyReadWriteSubcommand(args, []string{"list"}, []string{"delete", "set"}, "secrets", false, "Secret write")
	case "variable":
		return classifyReadWriteSubcommand(args, []string{"get", "list"}, []string{"delete", "set"}, "actions_variables", false, "Variable write")
	case "project":
		return classifyReadWriteSubcommand(args,
			[]string{"field-list", "item-list", "list", "view"},
			[]string{"close", "copy", "create", "delete", "edit", "field-create", "field-delete", "item-add", "item-archive", "item-create", "item-delete", "item-edit", "link", "mark-template", "unlink"},
			"projects", false, "Project write")
	case "discussion":
		return classifyReadWriteSubcommand(args, []string{"list", "view"}, []string{"comment", "create", "edit"}, "discussions", false, "Discussion write")
	case "gist":
		return classifyReadWriteSubcommand(args, []string{"clone", "list", "view"}, []string{"create", "delete", "edit", "rename"}, "gists", false, "Gist write")
	case "codespace":
		return classifyReadWriteSubcommand(args,
			[]string{"code", "jupyter", "list", "logs", "ports", "ssh", "view"},
			[]string{"cp", "create", "delete", "edit", "rebuild", "stop"},
			"codespaces", false, "Codespace write")
	case "gpg-key":
		return classifyReadWriteSubcommand(args, []string{"list"}, []string{"add", "delete"}, "gpg_keys", false, "GPG key write")
	case "ssh-key":
		return classifyReadWriteSubcommand(args, []string{"list"}, []string{"add", "delete"}, "ssh_signing_keys", false, "SSH key write")
	case "agent-task":
		return classifyReadWriteSubcommand(args, []string{"list", "view"}, []string{"create"}, "agents", false, "Agent task write")
	case "skill":
		return classifyReadWriteSubcommand(args, []string{"install", "list", "preview", "search", "update"}, []string{"publish"}, "contents", false, "Skill publish")
	case "extension":
		if len(args) < 2 {
			return ghOperation{Kind: ghReadOnly}
		}
		if args[1] == "exec" {
			return ghOperation{Kind: ghUnknown}
		}
		for _, local := range []string{"browse", "create", "install", "list", "remove", "search", "upgrade"} {
			if args[1] == local {
				return ghOperation{Kind: ghReadOnly}
			}
		}
		return ghOperation{Kind: ghUnknown}
	default:
		return ghOperation{Kind: ghUnknown}
	}
}

func stripGitHubGlobalFlags(args []string) ([]string, bool, bool) {
	for len(args) > 0 && strings.HasPrefix(args[0], "-") {
		arg := args[0]
		switch {
		case arg == "--help" || arg == "-h" || arg == "--version":
			return nil, true, true
		case arg == "-R" || arg == "--repo" || arg == "--hostname":
			if len(args) < 2 {
				return nil, false, false
			}
			args = args[2:]
		case strings.HasPrefix(arg, "--repo=") || strings.HasPrefix(arg, "--hostname="):
			args = args[1:]
		default:
			return nil, false, false
		}
	}
	return args, false, true
}

func normalizeGitHubAlias(args []string) []string {
	normalized := append([]string(nil), args...)
	switch normalized[0] {
	case "co":
		return append([]string{"pr", "checkout"}, normalized[1:]...)
	case "cs":
		normalized[0] = "codespace"
	case "at":
		normalized[0] = "attestation"
	case "ext", "extensions":
		normalized[0] = "extension"
	case "rs":
		normalized[0] = "ruleset"
	case "agent", "agents", "agent-tasks":
		normalized[0] = "agent-task"
	case "skills":
		normalized[0] = "skill"
	}
	return normalized
}

func classifySubcommand(args []string, readOnly map[string]bool) ghOperation {
	if len(args) < 2 {
		return ghOperation{Kind: ghReadOnly}
	}
	if readOnly[args[1]] {
		return ghOperation{Kind: ghReadOnly}
	}
	return ghOperation{Kind: ghUnknown}
}

func classifyReadWriteSubcommand(args, reads, writes []string, permission string, humanVisible bool, description string) ghOperation {
	if len(args) < 2 {
		return ghOperation{Kind: ghReadOnly}
	}
	for _, read := range reads {
		if args[1] == read {
			return ghOperation{Kind: ghReadOnly}
		}
	}
	for _, write := range writes {
		if args[1] == write {
			return ghOperation{Kind: ghWrite, Permission: permission, HumanVisible: humanVisible, Description: description}
		}
	}
	return ghOperation{Kind: ghUnknown}
}

func classifyRepositoryCommand(args []string) ghOperation {
	if len(args) == 0 {
		return ghOperation{Kind: ghReadOnly}
	}
	switch args[0] {
	case "clone", "gitignore", "license", "list", "read-dir", "read-file", "set-default", "view":
		return ghOperation{Kind: ghReadOnly}
	case "sync":
		return ghOperation{Kind: ghWrite, Permission: "contents", Description: "Repository sync"}
	case "archive", "create", "delete", "edit", "fork", "rename", "unarchive":
		return ghOperation{Kind: ghWrite, Permission: "administration", Description: "Repository administration"}
	case "autolink":
		if len(args) > 1 && (args[1] == "get" || args[1] == "list") {
			return ghOperation{Kind: ghReadOnly}
		}
		if len(args) > 1 && (args[1] == "create" || args[1] == "delete") {
			return ghOperation{Kind: ghWrite, Permission: "administration", Description: "Repository autolink write"}
		}
	case "deploy-key":
		if len(args) > 1 && args[1] == "list" {
			return ghOperation{Kind: ghReadOnly}
		}
		if len(args) > 1 && (args[1] == "add" || args[1] == "delete") {
			return ghOperation{Kind: ghWrite, Permission: "administration", Description: "Deploy key write"}
		}
	}
	return ghOperation{Kind: ghUnknown}
}

func classifyGitHubAPI(args []string) ghOperation {
	method := ""
	endpoint := ""
	query := ""
	queryFromFile := false
	hasFields := false
	hasInput := false

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case (arg == "--help" || arg == "-h") && endpoint == "":
			return ghOperation{Kind: ghReadOnly}
		case arg == "-X" || arg == "--method":
			if i+1 >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
			i++
			method = strings.ToUpper(args[i])
		case strings.HasPrefix(arg, "-X") && len(arg) > 2:
			method = strings.ToUpper(strings.TrimPrefix(arg, "-X"))
		case strings.HasPrefix(arg, "--method="):
			method = strings.ToUpper(strings.TrimPrefix(arg, "--method="))
		case arg == "-f" || arg == "--raw-field":
			if i+1 >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
			i++
			hasFields = true
			if key, value, ok := strings.Cut(args[i], "="); ok && key == "query" {
				query = value
			}
		case arg == "-F" || arg == "--field":
			if i+1 >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
			i++
			hasFields = true
			if key, value, ok := strings.Cut(args[i], "="); ok && key == "query" {
				query = value
				queryFromFile = strings.HasPrefix(value, "@")
			}
		case strings.HasPrefix(arg, "-f") && len(arg) > 2:
			hasFields = true
			if key, value, ok := strings.Cut(strings.TrimPrefix(arg, "-f"), "="); ok && key == "query" {
				query = value
			}
		case strings.HasPrefix(arg, "-F") && len(arg) > 2:
			hasFields = true
			if key, value, ok := strings.Cut(strings.TrimPrefix(arg, "-F"), "="); ok && key == "query" {
				query = value
				queryFromFile = strings.HasPrefix(value, "@")
			}
		case strings.HasPrefix(arg, "--raw-field="):
			hasFields = true
			field := strings.SplitN(arg, "=", 2)[1]
			if key, value, ok := strings.Cut(field, "="); ok && key == "query" {
				query = value
			}
		case strings.HasPrefix(arg, "--field="):
			hasFields = true
			field := strings.SplitN(arg, "=", 2)[1]
			if key, value, ok := strings.Cut(field, "="); ok && key == "query" {
				query = value
				queryFromFile = strings.HasPrefix(value, "@")
			}
		case arg == "--input":
			if i+1 >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
			i++
			hasInput = true
		case strings.HasPrefix(arg, "--input="):
			hasInput = true
		case apiFlagNeedsValue(arg):
			if strings.Contains(arg, "=") || apiAttachedShortFlag(arg) {
				continue
			}
			i++
			if i >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
		case apiBooleanFlag(arg):
			continue
		case strings.HasPrefix(arg, "-"):
			return ghOperation{Kind: ghUnknown}
		case endpoint == "":
			endpoint = arg
		}
	}

	if endpoint == "" {
		return ghOperation{Kind: ghUnknown}
	}
	if endpoint == "graphql" {
		if hasInput || query == "" || queryFromFile {
			return ghOperation{Kind: ghUnknown}
		}
		document, err := parser.ParseQuery(&ast.Source{Name: "hook", Input: query})
		if err != nil || len(document.Operations) == 0 {
			return ghOperation{Kind: ghUnknown}
		}
		for _, operation := range document.Operations {
			if operation.Operation != ast.Query {
				return ghOperation{Kind: ghWrite, Description: "GraphQL mutation"}
			}
		}
		return ghOperation{Kind: ghReadOnly}
	}

	if method == "" {
		if hasFields || hasInput {
			method = http.MethodPost
		} else {
			method = http.MethodGet
		}
	}
	if method == http.MethodGet || method == http.MethodHead {
		return ghOperation{Kind: ghReadOnly}
	}

	permission := permissionForRESTEndpoint(endpoint)
	if permission == "" {
		return ghOperation{Kind: ghWrite, Description: "GitHub API write"}
	}
	return ghOperation{Kind: ghWrite, Permission: permission, Description: "GitHub API write"}
}

func apiFlagNeedsValue(arg string) bool {
	name := arg
	if before, _, found := strings.Cut(arg, "="); found {
		name = before
	}
	if len(arg) > 2 && (strings.HasPrefix(arg, "-H") ||
		strings.HasPrefix(arg, "-q") ||
		strings.HasPrefix(arg, "-t")) {
		name = arg[:2]
	}
	switch name {
	case "-H", "--header",
		"--hostname",
		"--preview",
		"--cache",
		"-q", "--jq",
		"-t", "--template":
		return true
	default:
		return false
	}
}

func apiAttachedShortFlag(arg string) bool {
	return len(arg) > 2 &&
		(strings.HasPrefix(arg, "-H") ||
			strings.HasPrefix(arg, "-q") ||
			strings.HasPrefix(arg, "-t"))
}

func apiBooleanFlag(arg string) bool {
	switch arg {
	case "--paginate", "--slurp", "--verbose", "--include", "-i", "--silent":
		return true
	default:
		return false
	}
}

func permissionForRESTEndpoint(endpoint string) string {
	endpoint = strings.TrimPrefix(endpoint, "/")
	parts := strings.Split(endpoint, "/")
	if len(parts) < 4 || parts[0] != "repos" {
		return ""
	}
	switch parts[3] {
	case "contents", "git", "releases":
		return "contents"
	case "issues", "labels", "milestones":
		return "issues"
	case "pulls":
		return "pull_requests"
	case "actions":
		return "actions"
	default:
		return ""
	}
}
