package main

import (
	"fmt"
	"net/url"
	"os/exec"
	"path"
	"sort"
	"strings"
)

type githubRepository struct {
	Owner string
	Name  string
}

func (r githubRepository) String() string {
	if r.Owner == "" || r.Name == "" {
		return ""
	}
	return r.Owner + "/" + r.Name
}

func parseGitHubRepository(value string) (githubRepository, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return githubRepository{}, fmt.Errorf("GitHub repository is empty")
	}

	// Git's SCP-like syntax is not accepted by net/url.
	if !strings.Contains(raw, "://") {
		if at := strings.LastIndex(raw, "@"); at >= 0 {
			raw = raw[at+1:]
		}
	}
	if !strings.Contains(raw, "://") && strings.Contains(raw, ":") {
		host, repositoryPath, _ := strings.Cut(raw, ":")
		raw = "ssh://" + host + "/" + repositoryPath
	}

	host := ""
	repositoryPath := raw
	if parsed, err := url.Parse(raw); err == nil && parsed.Host != "" {
		host = strings.ToLower(parsed.Hostname())
		repositoryPath = parsed.Path
	}
	if host != "" && host != "github.com" {
		return githubRepository{}, fmt.Errorf("remote host %q is not github.com", host)
	}

	// Trim the slashes first: a remote written as ".../owner/repo.git/" would
	// otherwise keep its suffix, because TrimSuffix sees the trailing slash.
	repositoryPath = strings.TrimSuffix(strings.Trim(repositoryPath, "/"), ".git")
	parts := strings.Split(repositoryPath, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" ||
		parts[0] == "." || parts[1] == "." || parts[0] == ".." || parts[1] == ".." {
		return githubRepository{}, fmt.Errorf("GitHub repository %q must be owner/repo", value)
	}
	return githubRepository{Owner: parts[0], Name: parts[1]}, nil
}

var gitRemoteURL = func() (string, error) {
	for _, args := range [][]string{
		{"remote", "get-url", "--push", "origin"},
		{"remote", "get-url", "origin"},
	} {
		output, err := exec.Command("git", args...).Output()
		if err == nil && strings.TrimSpace(string(output)) != "" {
			return strings.TrimSpace(string(output)), nil
		}
	}
	return "", fmt.Errorf("cannot resolve the current Git remote; pass --repo owner/repo")
}

func resolveGitHubRepository(explicit string) (githubRepository, error) {
	if strings.TrimSpace(explicit) != "" {
		return parseGitHubRepository(explicit)
	}
	remote, err := gitRemoteURL()
	if err != nil {
		return githubRepository{}, err
	}
	return parseGitHubRepository(remote)
}

// errAmbiguousGitHubRepositoryFlag reports that a `-R`/`--repo` token was found
// at a position where its meaning cannot be proven: the token before it is a
// flag whose arity this parser does not know, so the `-R` may be that flag's
// value rather than a repository selector.
//
// gh's short flags are per-subcommand and contradict each other — `-m` is
// `--milestone` (a value) on `pr create` but `--merge` (a boolean) on
// `pr merge`; `-w` is `--web` on `pr view` and `--workflow` on `run list`. A
// single global arity table therefore cannot be right, and guessing is unsafe
// in both directions: mistaking a value for a flag lets crafted text choose the
// repository, while mistaking a boolean for a value swallows a real `-R` and
// authorizes against the wrong one. So ambiguity is reported rather than
// resolved, and callers fail closed (#2211).
var errAmbiguousGitHubRepositoryFlag = fmt.Errorf(
	"cannot prove which repository this command targets: place `-R owner/repo` " +
		"immediately after the gh subcommand, or use `--repo=owner/repo`")

// ghLongFlagTakesValue lists long flags that always consume the next argument.
// Long flags do not collide across subcommands the way short flags do, so this
// table is safe to apply globally.
func ghLongFlagTakesValue(arg string) bool {
	switch arg {
	case "--repo", "--hostname",
		"--body", "--body-file", "--title", "--template",
		"--message", "--notes", "--notes-file", "--subject",
		"--field", "--raw-field", "--input", "--header", "--method",
		"--jq", "--json", "--cache", "--preview",
		"--label", "--add-label", "--remove-label",
		"--assignee", "--add-assignee", "--remove-assignee",
		"--reviewer", "--add-reviewer",
		"--milestone", "--project", "--add-project", "--remove-project",
		"--base", "--head", "--branch", "--ref", "--sha",
		"--limit", "--state", "--author", "--search",
		"--description", "--name", "--value", "--key",
		"--output", "--file", "--filename", "--config", "--env",
		"--workflow", "--team", "--org", "--user", "--visibility":
		return true
	default:
		return false
	}
}

// ghLongFlagIsBoolean lists long flags that consume nothing. Knowing these
// keeps a `-R` that follows one from being reported as ambiguous, which is what
// makes `gh pr create --draft -R owner/repo` resolve instead of denying.
func ghLongFlagIsBoolean(arg string) bool {
	switch arg {
	case "--draft", "--web", "--merge", "--squash", "--rebase",
		"--delete-branch", "--auto", "--disable-auto", "--admin",
		"--fill", "--fill-first", "--fill-verbose", "--no-maintainer-edit",
		"--dry-run", "--force", "--yes", "--confirm", "--clone",
		"--public", "--private", "--internal", "--push",
		"--paginate", "--slurp", "--verbose", "--include", "--silent",
		"--help", "--version":
		return true
	default:
		return false
	}
}

// explicitGitHubRepository extracts the repository a gh command explicitly
// targets. It returns errAmbiguousGitHubRepositoryFlag when the target cannot
// be proven; callers must fail closed rather than fall back to the remote.
func explicitGitHubRepository(args []string) (githubRepository, bool, error) {
	// pendingValue: the current token is the value of the previous flag.
	// unknownArity: the previous token was a flag of unknown arity, so the
	// current token may be its value rather than a flag in its own right.
	pendingValue := false
	unknownArity := false

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			// Everything after the terminator is positional, never a flag.
			break
		}
		if pendingValue {
			pendingValue = false
			continue
		}

		isRepoFlag := arg == "-R" || arg == "--repo" ||
			strings.HasPrefix(arg, "--repo=") ||
			(strings.HasPrefix(arg, "-R") && len(arg) > 2)
		if unknownArity {
			if isRepoFlag {
				return githubRepository{}, false, errAmbiguousGitHubRepositoryFlag
			}
			// Not a repository selector, so whichever way the previous flag's
			// arity fell, this token sits at a flag position again.
			unknownArity = false
		}

		var value string
		switch {
		case arg == "-R" || arg == "--repo":
			if i+1 >= len(args) {
				return githubRepository{}, false, fmt.Errorf("%s requires owner/repo", arg)
			}
			value = args[i+1]
		case strings.HasPrefix(arg, "--repo="):
			value = strings.TrimPrefix(arg, "--repo=")
		case strings.HasPrefix(arg, "-R") && len(arg) > 2:
			// gh accepts the attached form, but so does any free-text value that
			// happens to start with -R, and the two are indistinguishable here.
			return githubRepository{}, false, errAmbiguousGitHubRepositoryFlag
		case ghLongFlagTakesValue(arg):
			pendingValue = true
			continue
		case ghLongFlagIsBoolean(arg):
			continue
		case strings.HasPrefix(arg, "--") && strings.Contains(arg, "="):
			// An unrecognized --name=value carries its own value.
			continue
		case strings.HasPrefix(arg, "-") && arg != "-":
			// Any other flag, including every short flag: arity unknown.
			unknownArity = true
			continue
		default:
			continue
		}
		repository, err := parseGitHubRepository(value)
		return repository, true, err
	}
	return githubRepository{}, false, nil
}

type githubTokenRequest struct {
	Repository  githubRepository
	Permissions map[string]string
}

func (r githubTokenRequest) permissionKey() string {
	if len(r.Permissions) == 0 {
		return "all"
	}
	keys := make([]string, 0, len(r.Permissions))
	for key := range r.Permissions {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+strings.ToLower(strings.TrimSpace(r.Permissions[key])))
	}
	return strings.Join(parts, ",")
}

func githubTokenRequestForGHArgs(args []string) (githubTokenRequest, error) {
	repository, found, err := explicitGitHubRepository(args)
	if err != nil {
		return githubTokenRequest{}, err
	}
	if !found {
		repository, err = resolveGitHubRepository("")
		if err != nil {
			return githubTokenRequest{}, err
		}
	}
	request := githubTokenRequest{Repository: repository}
	op := classifyGitHubOperation(args)
	if op.Kind == ghWrite && op.Permission != "" {
		request.Permissions = map[string]string{op.Permission: "write"}
	}
	return request, nil
}

// githubRepositoryForCredentialRequest resolves the repository a Git
// credential request is for. Git only sends `path=` when
// credential.useHttpPath is set, and gitconfigs written before that key was
// installed do not have it, so an absent path resolves from the current remote
// rather than failing the push (#2211).
func githubRepositoryForCredentialRequest(host, requestPath string) (githubRepository, error) {
	if normalized := strings.ToLower(strings.TrimSpace(host)); normalized != "" && normalized != "github.com" {
		return githubRepository{}, fmt.Errorf("credential host %q is not github.com", host)
	}
	if strings.TrimSpace(requestPath) == "" {
		repository, err := resolveGitHubRepository("")
		if err != nil {
			return githubRepository{}, fmt.Errorf(
				"Git did not send a repository path and the current remote could not be resolved: %w "+
					"(run `moltnet github setup` to enable credential.useHttpPath)", err)
		}
		return repository, nil
	}
	return githubRepositoryFromCredentialPath(host, requestPath)
}

func githubRepositoryFromCredentialPath(host, requestPath string) (githubRepository, error) {
	if host = strings.ToLower(strings.TrimSpace(host)); host != "" && host != "github.com" {
		return githubRepository{}, fmt.Errorf("credential host %q is not github.com", host)
	}
	return parseGitHubRepository(path.Clean("/" + strings.TrimSpace(requestPath)))
}
