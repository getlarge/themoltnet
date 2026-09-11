package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
	"path"
	"sort"
	"strings"
	"time"
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

// gitRemoteTimeout bounds each `git remote get-url` read. It only reads local
// config, but it sits on every minting path — including the credential helper
// that Git runs during a push — so a wedged git (a stale lock, a slow network
// filesystem) must fail the lookup rather than hang the push.
var gitRemoteTimeout = 5 * time.Second

var gitRemoteURL = func() (string, error) {
	for _, args := range [][]string{
		{"remote", "get-url", "--push", "origin"},
		{"remote", "get-url", "origin"},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), gitRemoteTimeout)
		command := exec.CommandContext(ctx, "git", args...)
		// Killing git does not close a pipe a grandchild still holds, so bound
		// the wait for output as well as the process itself.
		command.WaitDelay = time.Second
		output, err := command.Output()
		cancel()
		if err == nil && strings.TrimSpace(string(output)) != "" {
			return strings.TrimSpace(string(output)), nil
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", fmt.Errorf("reading the current Git remote timed out after %s; pass --repo owner/repo", gitRemoteTimeout)
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

// explicitGitHubRepository returns the repository a gh command names with
// -R/--repo, if any. gh (pflag) applies the LAST occurrence, so this does too.
//
// This feeds token minting only — never an authorization decision. The guard
// deliberately does not consult it: deriving the authorized repository from
// argv made attacker-influenced text able to steer which permissions were
// checked, and no approximation of pflag here was safe enough to rely on for
// that (#2211). A wrong guess in minting produces a token GitHub rejects with
// 403/404, which fails safe.
func explicitGitHubRepository(args []string) (githubRepository, bool, error) {
	value := ""
	found := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			break
		}
		switch {
		case (arg == "-R" || arg == "--repo") && i+1 < len(args):
			value = args[i+1]
			found = true
			i++
		case strings.HasPrefix(arg, "--repo="):
			value = strings.TrimPrefix(arg, "--repo=")
			found = true
		case strings.HasPrefix(arg, "-R") && len(arg) > 2:
			value = strings.TrimPrefix(arg, "-R")
			found = true
		}
	}
	if !found {
		return githubRepository{}, false, nil
	}
	repository, err := parseGitHubRepository(value)
	return repository, true, err
}

type githubTokenRequest struct {
	Repository  githubRepository
	Permissions map[string]string
	// RepositoryFromRemote is set when no -R/--repo named the target, so the
	// token was scoped to the current Git remote instead.
	RepositoryFromRemote bool
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
	request := githubTokenRequest{Repository: repository, RepositoryFromRemote: !found}
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
// execFailureHint explains a failed `github exec` whose token was scoped to the
// current Git remote. A command that names its target some other way — a
// `gh api repos/<owner>/<repo>` endpoint, or a repository given as a plain
// argument — is not parsed for it: modelling gh's grammar is where earlier
// attempts at this went wrong. The token then covers the wrong repository and
// GitHub answers 403 or 404, so say which repository it covered and how to
// change it, instead of leaving an unexplained error.
func (r githubTokenRequest) execFailureHint() string {
	if !r.RepositoryFromRemote || r.Repository.String() == "" {
		return ""
	}
	return fmt.Sprintf("moltnet github exec: the GitHub token was scoped to %s, the current Git remote; "+
		"if this command targets another repository, pass -R owner/repo", r.Repository)
}

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
