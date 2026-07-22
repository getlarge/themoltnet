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

const githubGuardPermissionTimeout = 2 * time.Second

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

// runGitHubGuardCmd implements the hook contract. Every internal failure is a
// silent allow; the only output this command ever writes is a deny decision.
func runGitHubGuardCmd(in io.Reader, out io.Writer) error {
	return runGitHubGuard(in, out, currentGitHubGuardContext, loadGitHubGuardPermissions)
}

func runGitHubGuard(
	in io.Reader,
	out io.Writer,
	resolveContext func() (githubGuardContext, bool),
	permissions guardPermissionLoader,
) error {
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
		cmd := exec.Command("git", "rev-parse", "--show-toplevel")
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
	}, true
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

	details, err := getCachedInstallationTokenDetails(
		ctx,
		&http.Client{Timeout: githubGuardPermissionTimeout},
		creds.GitHub.AppID,
		creds.GitHub.PrivateKeyPath,
		creds.GitHub.InstallationID,
	)
	if err != nil {
		return nil, err
	}
	return details.Permissions, nil
}

func evaluateGitHubGuard(command string, guardCtx githubGuardContext, permissions guardPermissionLoader) string {
	return evaluateGitHubGuardScript(command, guardCtx, permissions, false, 0)
}

func evaluateGitHubGuardScript(
	command string,
	guardCtx githubGuardContext,
	permissions guardPermissionLoader,
	inheritedToken bool,
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
		if nested, ok := literalNestedShellScript(executable, args); ok {
			if depth >= 8 {
				denial = "Nested shell command is too deep for the GitHub authorship guard to verify."
				return false
			}
			denial = evaluateGitHubGuardScript(
				nested,
				guardCtx,
				permissions,
				inheritedToken || scopedToken,
				depth+1,
			)
			return denial == ""
		}
		if filepath.Base(executable) != "gh" {
			return true
		}

		op := ghOperation{Kind: ghUnknown}
		if args != nil {
			op = classifyGitHubOperation(args)
		}
		if op.Kind == ghReadOnly {
			return true
		}
		if op.Kind == ghUnknown || op.Permission == "" {
			denial = "Cannot prove this gh command is read-only or map it to a supported GitHub App permission. Use a recognized gh operation, or run the command outside the activated MoltNet agent context."
			return false
		}
		if scopedToken || inheritedToken {
			return true
		}
		if op.HumanVisible && guardCtx.AuthorshipMode == "human" {
			return true
		}

		ctx, cancel := context.WithTimeout(context.Background(), githubGuardPermissionTimeout)
		granted, loadErr := permissions(ctx, guardCtx.CredentialsPath)
		cancel()
		if loadErr != nil {
			// Hook state is optional. A missing cache, credentials file, or network
			// response must never turn into a hook execution error.
			return true
		}
		if !permissionAllowsWrite(granted[op.Permission]) {
			// The installation cannot perform this operation, so gh may fall back
			// to the user's configured credential.
			return true
		}

		description := op.Description
		if description == "" {
			description = "GitHub write"
		}
		denial = fmt.Sprintf(
			"%s must be attributed to the active MoltNet GitHub App (%s:write). Retry with `GH_TOKEN=$(moltnet github token --credentials %q) gh ...` on this same command.",
			description,
			op.Permission,
			guardCtx.CredentialsPath,
		)
		return false
	})
	return denial
}

func literalNestedShellScript(executable string, args []string) (string, bool) {
	if args == nil {
		return "", false
	}
	base := filepath.Base(executable)
	if base == "eval" {
		if len(args) == 0 {
			return "", false
		}
		return strings.Join(args, " "), true
	}
	if base != "sh" && base != "bash" && base != "dash" && base != "zsh" {
		return "", false
	}
	for i, arg := range args {
		if arg == "--" {
			continue
		}
		if arg == "--command" || (strings.HasPrefix(arg, "-") && strings.Contains(strings.TrimPrefix(arg, "-"), "c")) {
			if i+1 < len(args) {
				return args[i+1], true
			}
			return "", false
		}
	}
	return "", false
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
	return executable, args, scopedToken, true
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

func classifyGitHubOperation(args []string) ghOperation {
	if len(args) == 0 || containsHelpFlag(args) {
		return ghOperation{Kind: ghReadOnly}
	}

	top := args[0]
	if strings.HasPrefix(top, "-") {
		return ghOperation{Kind: ghReadOnly}
	}
	switch top {
	case "co":
		args = append([]string{"pr", "checkout"}, args[1:]...)
	case "cs":
		args[0] = "codespace"
	case "at":
		args[0] = "attestation"
	case "ext", "extensions":
		args[0] = "extension"
	case "rs":
		args[0] = "ruleset"
	case "agent", "agents", "agent-tasks":
		args[0] = "agent-task"
	case "skills":
		args[0] = "skill"
	}
	top = args[0]

	switch top {
	case "api":
		return classifyGitHubAPI(args[1:])
	case "browse", "completion", "licenses", "search", "status", "help":
		return ghOperation{Kind: ghReadOnly}
	case "auth", "alias", "config":
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

func containsHelpFlag(args []string) bool {
	for _, arg := range args {
		if arg == "--help" || arg == "-h" || arg == "--version" {
			return true
		}
	}
	return false
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
	hasFields := false
	hasInput := false

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-X" || arg == "--method":
			if i+1 >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
			i++
			method = strings.ToUpper(args[i])
		case strings.HasPrefix(arg, "--method="):
			method = strings.ToUpper(strings.TrimPrefix(arg, "--method="))
		case arg == "-f" || arg == "--raw-field" || arg == "-F" || arg == "--field":
			if i+1 >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
			i++
			hasFields = true
			if key, value, ok := strings.Cut(args[i], "="); ok && key == "query" {
				query = value
			}
		case strings.HasPrefix(arg, "--raw-field=") || strings.HasPrefix(arg, "--field="):
			hasFields = true
			field := strings.SplitN(arg, "=", 2)[1]
			if key, value, ok := strings.Cut(field, "="); ok && key == "query" {
				query = value
			}
		case arg == "--input":
			if i+1 >= len(args) {
				return ghOperation{Kind: ghUnknown}
			}
			i++
			hasInput = true
		case strings.HasPrefix(arg, "--input="):
			hasInput = true
		case strings.HasPrefix(arg, "-"):
			// Formatting, pagination, hostname, and preview flags do not
			// alter whether the request writes.
			continue
		case endpoint == "":
			endpoint = arg
		}
	}

	if endpoint == "" {
		return ghOperation{Kind: ghUnknown}
	}
	if endpoint == "graphql" {
		if hasInput || query == "" || strings.HasPrefix(query, "@") {
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
