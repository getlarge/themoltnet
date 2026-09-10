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

// ghFlagNeedsValue reports whether a gh flag consumes the argument after it.
// The repository scan has to skip those values: free text such as
// `--body "-Rowner/repo"` is a value, not a flag, and reading it as one let
// crafted text decide which repository the guard authorized against and which
// repository a token was minted for (#2211).
//
// A flag written as `--name=value` carries its own value and consumes nothing.
// Unknown flags are treated as boolean, which stays safe because a target that
// cannot be determined now denies instead of falling back to the remote.
func ghFlagNeedsValue(arg string) bool {
	if _, _, found := strings.Cut(arg, "="); found {
		return false
	}
	switch arg {
	case "-R", "--repo", "--hostname",
		"-b", "--body", "--body-file",
		"-t", "--title", "--template",
		"-m", "--message", "--notes", "--notes-file", "--subject",
		"-f", "--raw-field", "-F", "--field", "--input",
		"-H", "--header", "-X", "--method",
		"-q", "--jq", "--json", "--cache", "--preview",
		"-l", "--label", "-a", "--assignee", "-r", "--reviewer",
		"--milestone", "-p", "--project",
		"-B", "--base", "--head", "--branch", "--ref", "--sha",
		"-L", "--limit", "-s", "--state", "-A", "--author", "-S", "--search",
		"-d", "--description", "-n", "--name", "--value", "--key",
		"-o", "--output", "--file", "--filename", "--config", "--env",
		"-w", "--workflow", "--team", "--org", "-u", "--user", "--visibility":
		return true
	default:
		return false
	}
}

func explicitGitHubRepository(args []string) (githubRepository, bool, error) {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			// Everything after the terminator is positional, never a flag.
			break
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
			// Refuse to guess rather than authorize against the wrong repository.
			return githubRepository{}, false, fmt.Errorf(
				"pass the repository as `-R owner/repo` or `--repo=owner/repo`; %q is ambiguous", arg)
		default:
			if ghFlagNeedsValue(arg) {
				i++
			}
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
