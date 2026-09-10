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

	repositoryPath = strings.Trim(strings.TrimSuffix(repositoryPath, ".git"), "/")
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

func explicitGitHubRepository(args []string) (githubRepository, bool, error) {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		var value string
		switch {
		case arg == "-R" || arg == "--repo":
			if i+1 >= len(args) {
				return githubRepository{}, false, fmt.Errorf("%s requires owner/repo", arg)
			}
			i++
			value = args[i]
		case strings.HasPrefix(arg, "--repo="):
			value = strings.TrimPrefix(arg, "--repo=")
		case strings.HasPrefix(arg, "-R") && len(arg) > 2:
			value = strings.TrimPrefix(arg, "-R")
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

func githubRepositoryFromCredentialPath(host, requestPath string) (githubRepository, error) {
	if host = strings.ToLower(strings.TrimSpace(host)); host != "" && host != "github.com" {
		return githubRepository{}, fmt.Errorf("credential host %q is not github.com", host)
	}
	return parseGitHubRepository(path.Clean("/" + strings.TrimSpace(requestPath)))
}
