package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
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

// secretGuardPathContext anchors path classification to the repositories that
// own the active guard. currentRoot is the checkout the tool runs in; mainRoot
// is the stable root shared by linked worktrees. Keeping both prevents an
// absolute or nested-CWD spelling from bypassing managed-config protection.
type secretGuardPathContext struct {
	cwd         string
	currentRoot string
	mainRoot    string
}

func resolveSecretGuardPathContext() (secretGuardPathContext, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return secretGuardPathContext{}, fmt.Errorf("get working directory: %w", err)
	}
	currentRoot, err := currentRepoRoot()
	if err != nil {
		return secretGuardPathContext{}, err
	}
	mainRoot, ok := resolveGitCommonRoot(cwd)
	if !ok {
		mainRoot = currentRoot
	}
	return newSecretGuardPathContext(cwd, currentRoot, mainRoot), nil
}

func newSecretGuardPathContext(cwd, currentRoot, mainRoot string) secretGuardPathContext {
	return secretGuardPathContext{
		cwd:         canonicalizeRoot(cwd),
		currentRoot: canonicalizeRoot(currentRoot),
		mainRoot:    canonicalizeRoot(mainRoot),
	}
}

func runSecretsGuardCmd(in io.Reader, out io.Writer) error {
	_, active, err := currentMoltnetGitConfigPath()
	if !active {
		return nil
	}
	if err != nil {
		return writeSecretGuardDenial(out, secretGuardFailure)
	}
	return runActiveSecretsGuardCmd(in, out)
}

func runActiveSecretsGuardCmd(in io.Reader, out io.Writer) error {
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
	pathContext, err := resolveSecretGuardPathContext()
	if err != nil {
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
			reason = evaluateSecretsShellWithContext(command, pathContext)
		}
	case "read", "write", "edit", "grep", "glob", "applypatch":
		reason = evaluateSecretsFileTool(input.ToolInput, tool, pathContext)
	default:
		// Hosts add tool names faster than the guard can release. Unknown tools
		// remain allowed only when their path-bearing fields do not target a
		// protected location.
		reason = evaluateSecretsFileTool(input.ToolInput, tool, pathContext)
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

func evaluateSecretsFileTool(input map[string]any, tool string, pathContext secretGuardPathContext) string {
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
			class := classifyProtectedPathWithContext(value, pathContext)
			if class == pathCredential {
				return "Direct agent file-tool access to MoltNet credential material is blocked. Use activation, env check, or another non-revealing MoltNet command."
			}
			if class == pathManagedConfig && isWriteTool {
				return "Direct agent file-tool mutation of MoltNet enforcement files is blocked. Use a reviewed non-revealing MoltNet command or edit outside the activated agent session."
			}
		case "patch", "patchtext":
			if patchTouchesProtectedSecret(value, pathContext) {
				return "A patch targeting MoltNet credential material is blocked. Use a reviewed non-revealing MoltNet command."
			}
		}
	}
	return ""
}

func patchTouchesProtectedSecret(patch string, pathContext secretGuardPathContext) bool {
	prefixes := []string{"*** Add File:", "*** Update File:", "*** Delete File:", "*** Move to:", "--- ", "+++ "}
	for _, line := range strings.Split(patch, "\n") {
		line = strings.TrimSpace(line)
		for _, prefix := range prefixes {
			if !strings.HasPrefix(line, prefix) {
				continue
			}
			path := strings.TrimSpace(strings.TrimPrefix(line, prefix))
			path = strings.TrimPrefix(strings.TrimPrefix(path, "a/"), "b/")
			if pathTouchesProtectedSecret(path, pathContext) {
				return true
			}
		}
	}
	return false
}

func evaluateSecretsShell(command string) string {
	pathContext, err := resolveSecretGuardPathContext()
	if err != nil {
		return secretGuardFailure
	}
	return evaluateSecretsShellWithContext(command, pathContext)
}

func evaluateSecretsShellWithContext(command string, pathContext secretGuardPathContext) string {
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
				switch classifyProtectedPathWithContext(target, pathContext) {
				case pathCredential:
					denial = "Shell redirection involving MoltNet credential material is blocked."
					return false
				case pathManagedConfig:
					denial = "Shell redirection into MoltNet enforcement files is blocked."
					return false
				}
			} else if shellWordMentionsProtectedPath(node.Word, pathContext) {
				denial = "Shell redirection involving MoltNet credential material is blocked."
				return false
			}
		case *syntax.CallExpr:
			executable, args, _, ok, argsComplete := parseShellInvocation(node, "", vars)
			if !ok {
				if callMentionsProtectedPath(node, pathContext) {
					denial = "An unresolved shell invocation references MoltNet credential material. Use a statically verifiable non-revealing command."
					return false
				}
				return true
			}
			if isKeyringRevealCommand(executable, args) {
				denial = "Direct OS credential-store reads are blocked in activated agent sessions. Use a non-revealing MoltNet consumer."
				return false
			}
			if callSelectsUntrustedSecretDestination(executable, args, node) {
				denial = "Secret-moving MoltNet commands may only target the OS keyring in activated agent sessions; run them with a file destination from a human-controlled terminal."
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
				switch classifyProtectedPathWithContext(arg, pathContext) {
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
					if shellWordMentionsProtectedPath(word, pathContext) {
						hasCredentialArg = true
						break
					}
				}
			}

			if !hasCredentialArg && !hasManagedConfigArg {
				// No explicit protected path — check for implicit recursive
				// traversal that could expose .moltnet/ credentials (issue #1868).
				if isRecursiveTraversalRisk(executable, args, pathContext) {
					denial = "Recursive traversal from the repository root may expose MoltNet credential material under .moltnet/. Specify explicit paths that exclude .moltnet/."
					return false
				}
				return true
			}

			// Credential paths: always deny generic access (existing behavior).
			if hasCredentialArg {
				if isSecretMetadataCommand(executable, args, pathContext) || isReviewedMoltnetConsumer(executable, args, allowGitHubToken, pathContext) {
					return true
				}
				denial = fmt.Sprintf("%s may access protected MoltNet credential material. Use activation, env check, or another reviewed non-revealing MoltNet command.", filepath.Base(executable))
				return false
			}

			// Managed config paths: allow reads, deny mutations (issue #1868).
			if isManagedConfigReadCommand(executable, args, pathContext) {
				return true
			}
			if isSecretMetadataCommand(executable, args, pathContext) {
				return true
			}
			denial = fmt.Sprintf("%s may modify managed MoltNet enforcement files. Use a reviewed MoltNet command or edit outside the activated agent session.", filepath.Base(executable))
			return false
		}
		return true
	})
	return denial
}

func callMentionsProtectedPath(call *syntax.CallExpr, pathContext secretGuardPathContext) bool {
	for _, word := range call.Args {
		if shellWordMentionsProtectedPath(word, pathContext) {
			return true
		}
	}
	return false
}

func shellWordMentionsProtectedPath(word *syntax.Word, pathContext secretGuardPathContext) bool {
	if wordExpandsSecretRoot(word) {
		return true
	}
	mentions := false
	var literals strings.Builder
	syntax.Walk(word, func(node syntax.Node) bool {
		literal, ok := node.(*syntax.Lit)
		if !ok {
			return true
		}
		literals.WriteString(literal.Value)
		value := filepath.ToSlash(literal.Value)
		if pathTouchesProtectedSecret(value, pathContext) {
			mentions = true
			return false
		}
		return true
	})
	return mentions || pathTouchesProtectedSecret(literals.String(), pathContext)
}

func pathTouchesProtectedSecret(value string, pathContext secretGuardPathContext) bool {
	return classifyProtectedPathWithContext(value, pathContext) != pathNone
}

// classifyProtectedPath is retained for tests and compatibility helpers. Hook
// evaluation resolves the context once and calls classifyProtectedPathWithContext
// directly.
func classifyProtectedPath(value string) pathClass {
	pathContext, err := resolveSecretGuardPathContext()
	if err != nil {
		return classifyPathLexical(value)
	}
	return classifyProtectedPathWithContext(value, pathContext)
}

// classifyProtectedPathWithContext determines the protection class of a path
// relative to the active checkout and its main worktree. Absolute paths,
// nested-CWD spellings, and symlink aliases therefore receive the same class,
// while identical suffixes in unrelated directories remain unprotected.
func classifyProtectedPathWithContext(value string, pathContext secretGuardPathContext) pathClass {
	value = strings.TrimSpace(value)
	if value == "" {
		return pathNone
	}
	if class := classifySecretRootPath(value, pathContext.cwd, os.LookupEnv); class != pathNone {
		return class
	}
	if strings.ContainsAny(value, "*?[") {
		pattern := value
		if !filepath.IsAbs(pattern) {
			pattern = filepath.Join(pathContext.cwd, pattern)
		}
		matches, _ := filepath.Glob(pattern)
		for _, match := range matches {
			if class := classifyProtectedPathWithContext(match, pathContext); class != pathNone {
				return class
			}
		}
	}

	absolute := value
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(pathContext.cwd, absolute)
	}
	candidates := []string{filepath.Clean(absolute), canonicalizeGuardTarget(absolute)}
	for _, candidate := range candidates {
		for _, root := range pathContext.roots() {
			relative, ok := relativePathWithinRoot(root, candidate)
			if !ok {
				continue
			}
			if class := classifyRepoRelativePath(relative); class != pathNone {
				return class
			}
		}
	}

	// Preserve fail-closed handling for unresolved relative credential
	// references (for example a dynamic shell fragment containing .moltnet/).
	// Absolute paths must belong to an active root to avoid suffix false
	// positives in unrelated repositories.
	if !filepath.IsAbs(value) {
		if class := classifyCredentialPath(normalizePolicyPath(value)); class != pathNone {
			return class
		}
	}
	return pathNone
}

func (c secretGuardPathContext) roots() []string {
	if c.mainRoot == "" || c.mainRoot == c.currentRoot {
		return []string{c.currentRoot}
	}
	return []string{c.currentRoot, c.mainRoot}
}

func canonicalizeGuardTarget(path string) string {
	path = filepath.Clean(path)
	for existing := path; ; existing = filepath.Dir(existing) {
		if resolved, err := filepath.EvalSymlinks(existing); err == nil {
			remainder, relErr := filepath.Rel(existing, path)
			if relErr == nil {
				return filepath.Clean(filepath.Join(resolved, remainder))
			}
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return path
		}
	}
}

func relativePathWithinRoot(root, target string) (string, bool) {
	if root == "" {
		return "", false
	}
	relative, err := filepath.Rel(root, target)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return relative, true
}

func normalizePolicyPath(value string) string {
	return strings.ToLower(filepath.ToSlash(filepath.Clean(value)))
}

func classifyRepoRelativePath(value string) pathClass {
	value = normalizePolicyPath(value)
	if value == "." || value == "" {
		return pathNone
	}
	if class := classifyCredentialPath(value); class != pathNone {
		return class
	}
	if isManagedConfigPath(value) {
		return pathManagedConfig
	}
	return pathNone
}

func classifyPathLexical(value string) pathClass {
	// Treat policy paths case-insensitively. This intentionally errs on the
	// side of blocking case variants on case-sensitive hosts so the same hook
	// cannot be bypassed when a repository moves to macOS or Windows.
	if class := classifySecretRootPath(value, "", os.LookupEnv); class != pathNone {
		return class
	}
	value = normalizePolicyPath(value)
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

// classifySecretRootPath treats the headless secret root (MOLTNET_SECRET_ROOT)
// and everything beneath it as credential material, like .moltnet/. Only an
// absolute root is honoured — the providers reject relative roots for the
// same reason. Both sides are canonicalized so a symlink alias into the root
// receives the same class as the root path itself. Relative candidates are
// anchored to cwd; with an empty cwd only absolute candidates can match.
func classifySecretRootPath(value, cwd string, lookup func(string) (string, bool)) pathClass {
	root, ok := lookup(secretRootEnv)
	root = strings.TrimSpace(root)
	if !ok || root == "" || !filepath.IsAbs(root) {
		return pathNone
	}
	rootReal := canonicalizeExistingPath(filepath.Clean(root))
	candidate := strings.TrimSpace(value)
	if candidate == "" {
		return pathNone
	}
	if !filepath.IsAbs(candidate) {
		if cwd == "" {
			return pathNone
		}
		candidate = filepath.Join(cwd, candidate)
	}
	candidateReal := canonicalizeExistingPath(filepath.Clean(candidate))
	if candidateReal == rootReal {
		return pathCredential
	}
	rel, err := filepath.Rel(rootReal, candidateReal)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return pathNone
	}
	return pathCredential
}

// canonicalizeExistingPath resolves symlinks for the longest existing prefix
// of p and re-attaches the remaining components lexically, so paths that do
// not exist yet still compare against a canonical root.
func canonicalizeExistingPath(p string) string {
	existing := p
	var rest []string
	for {
		if resolved, err := filepath.EvalSymlinks(existing); err == nil {
			for i := len(rest) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, rest[i])
			}
			return resolved
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return p
		}
		rest = append(rest, filepath.Base(existing))
		existing = parent
	}
}

// wordExpandsSecretRoot reports whether a shell word references the headless
// secret root through parameter expansion ($MOLTNET_SECRET_ROOT or
// ${MOLTNET_SECRET_ROOT...}). The expansion is opaque to the static analyser,
// so any such reference fails closed as credential material.
func wordExpandsSecretRoot(word *syntax.Word) bool {
	found := false
	syntax.Walk(word, func(node syntax.Node) bool {
		if found {
			return false
		}
		if param, ok := node.(*syntax.ParamExp); ok && param.Param != nil && param.Param.Value == secretRootEnv {
			found = true
			return false
		}
		return true
	})
	return found
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
func isManagedConfigReadCommand(executable string, args []string, pathContext secretGuardPathContext) bool {
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
		if classifyProtectedPathWithContext(dest, pathContext) == pathManagedConfig {
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
func isRecursiveTraversalRisk(executable string, args []string, pathContext secretGuardPathContext) bool {
	base := filepath.Base(executable)
	switch base {
	case "rg", "ag":
		// rg traverses hidden files with --hidden or -H (short for --hidden
		// in ripgrep). Without --hidden, .moltnet/ is still searched because
		// it is not gitignored — but the guard checks for explicit dot targets.
		return hasRepositoryTraversalTarget(args, pathContext) && hasRecursiveFlag(args, "--hidden", "-H", "--no-ignore", "--no-ignore-vcs", "-u", "-uu", "--unrestricted")
	case "grep", "egrep", "fgrep":
		return hasRepositoryTraversalTarget(args, pathContext) && hasRecursiveFlag(args, "-R", "-r", "--recursive")
	case "find":
		return hasRepositoryTraversalTarget(args, pathContext)
	case "tar":
		return hasRepositoryTraversalTarget(args, pathContext)
	case "zip":
		return hasRepositoryTraversalTarget(args, pathContext) && hasRecursiveFlag(args, "-r", "--recurse-paths")
	case "rsync":
		return hasRepositoryTraversalTarget(args, pathContext)
	case "cp":
		return hasRepositoryTraversalTarget(args, pathContext) && hasRecursiveFlag(args, "-R", "-r", "--recursive")
	default:
		return false
	}
}

// hasRepositoryTraversalTarget reports whether any argument resolves to the
// active repository root or one of its ancestors. Traversing a nested
// directory is safe; traversing a root (regardless of spelling or CWD) can
// expose the .moltnet/ credential tree.
func hasRepositoryTraversalTarget(args []string, pathContext secretGuardPathContext) bool {
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		target := arg
		if !filepath.IsAbs(target) {
			target = filepath.Join(pathContext.cwd, target)
		}
		target = canonicalizeGuardTarget(target)
		for _, root := range pathContext.roots() {
			if _, containsRoot := relativePathWithinRoot(target, root); containsRoot {
				return true
			}
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

func isSecretMetadataCommand(executable string, args []string, pathContext secretGuardPathContext) bool {
	switch filepath.Base(executable) {
	case "stat":
		return true
	case "test", "[":
		for _, arg := range args {
			if arg == "-f" || arg == "-d" || arg == "-e" || arg == "]" {
				continue
			}
			if !pathTouchesProtectedSecret(arg, pathContext) {
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

func isReviewedMoltnetConsumer(executable string, args []string, allowGitHubToken bool, pathContext secretGuardPathContext) bool {
	args, ok := normalizedMoltnetArgs(executable, args)
	if !ok || len(args) == 0 || isMoltnetRevealArgs(args, allowGitHubToken) || moltnetArgsTouchNonCredentialSecret(args, pathContext) {
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
		[]string{"task", "grants", "list"},
		[]string{"task", "grants", "create"},
		[]string{"task", "grants", "revoke"},
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
		[]string{"agents", "enrollments", "create"},
		[]string{"agents", "enrollments", "revoke"},
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
		[]string{"config", "migrate"},
		[]string{"secrets", "guard"},
	) {
		return true
	}
	return matchesMoltnetOperation(args,
		[]string{"github", "setup"},
		[]string{"github", "guard"},
	) || (allowGitHubToken && matchesMoltnetOperation(args, []string{"github", "token"}))
}

func moltnetArgsTouchNonCredentialSecret(args []string, pathContext secretGuardPathContext) bool {
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == "--credentials" && index+1 < len(args) {
			index++
			continue
		}
		if strings.HasPrefix(arg, "--credentials=") {
			continue
		}
		if pathTouchesProtectedSecret(arg, pathContext) {
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

// isSecretMovingMoltnetArgs reports whether a moltnet invocation copies a
// credential into a secret provider: config migrate, and agents keys
// create/rotate with --store.
func isSecretMovingMoltnetArgs(args []string) bool {
	if matchesMoltnetOperation(args, []string{"config", "migrate"}) {
		return true
	}
	if len(args) >= 3 && args[0] == "agents" && args[1] == "keys" && (args[2] == "create" || args[2] == "rotate") {
		return argsContainFlag(args[3:], "--store")
	}
	return false
}

// callSelectsUntrustedSecretDestination denies secret-moving commands that
// could route protected material to an agent-selected location: a
// --destination other than the OS keyring (the file provider's root comes
// from the environment, which the same command line can set), or any
// MOLTNET_SECRET_ROOT* assignment or mention on the call. The guard
// classifies protected roots from its own environment, so material copied
// into an agent-chosen root would be readable afterwards.
func callSelectsUntrustedSecretDestination(executable string, args []string, call *syntax.CallExpr) bool {
	normalized, ok := normalizedMoltnetArgs(executable, args)
	if !ok || !isSecretMovingMoltnetArgs(normalized) {
		return false
	}
	for index, arg := range normalized {
		switch {
		case arg == "--destination":
			if index+1 >= len(normalized) || normalized[index+1] != osKeyringProviderName {
				return true
			}
		case strings.HasPrefix(arg, "--destination="):
			if strings.TrimPrefix(arg, "--destination=") != osKeyringProviderName {
				return true
			}
		case strings.Contains(arg, secretRootEnv):
			return true
		}
	}
	if call != nil {
		for _, assign := range call.Assigns {
			if assign.Name != nil && strings.HasPrefix(assign.Name.Value, secretRootEnv) {
				return true
			}
		}
	}
	return false
}

// argsContainFlag reports whether a bare boolean flag (or its =true form) is
// present in args.
func argsContainFlag(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag || arg == flag+"=true" {
			return true
		}
	}
	return false
}
