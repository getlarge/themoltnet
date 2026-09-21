package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
)

// A resolved context comes from exactly one of two places, and both are
// reported so the user can always see which one applied.
const (
	// contextSourceLocation: a binding stored for this location.
	contextSourceLocation = "location"
	// contextSourceIdentityDefault: no binding for this location, so the
	// identity-wide MOLTNET_TEAM_ID / MOLTNET_DIARY_ID from the identity env
	// file apply — the same values used before per-location contexts existed.
	contextSourceIdentityDefault = "identity-default"
)

type contextBinding struct {
	TeamID  string `json:"teamId"`
	DiaryID string `json:"diaryId"`
}

type resolvedContextBinding struct {
	Key string
	// Source is contextSourceLocation, contextSourceIdentityDefault, or empty
	// when neither applies.
	Source                string
	Binding               *contextBinding
	Project               *projectconfig.Binding
	skippedEndpointNotice func(io.Writer)
}

func (r resolvedContextBinding) teamID() string {
	if r.Binding == nil {
		return ""
	}
	return r.Binding.TeamID
}

func (r resolvedContextBinding) diaryID() string {
	if r.Binding == nil {
		return ""
	}
	return r.Binding.DiaryID
}

var contextWorkingDirectory = os.Getwd

func canonicalDirectory(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		cwd, err := contextWorkingDirectory()
		if err != nil {
			return "", err
		}
		value = cwd
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		absolute = resolved
	}
	return filepath.Clean(absolute), nil
}

// identityDefaultBinding returns the identity-wide team/diary pair from the
// identity env file, when both are set.
func identityDefaultBinding(agentDir string) (contextBinding, bool) {
	env, err := parseEnvFile(filepath.Join(agentDir, "env"))
	if err != nil {
		return contextBinding{}, false
	}
	binding := contextBinding{
		TeamID:  strings.TrimSpace(env["MOLTNET_TEAM_ID"]),
		DiaryID: strings.TrimSpace(env["MOLTNET_DIARY_ID"]),
	}
	if binding.TeamID == "" || binding.DiaryID == "" {
		return contextBinding{}, false
	}
	return binding, true
}

// resolveContextBinding resolves the team/diary for directory: its registered
// project binding if there is one, otherwise the identity default.
func resolveContextBinding(agentDir, directory string) (resolvedContextBinding, error) {
	return resolveNativeProjectContext(agentDir, directory)
}

// Local project selection is independent of credentials and never prepares a workspace.
func resolveContextBindingWithProjectOptions(agentDir, directory, configPath, bindingName string, endpointOverride ...string) (resolvedContextBinding, error) {
	canonical, err := canonicalDirectory(directory)
	if err != nil {
		return resolvedContextBinding{}, err
	}
	if configPath == "" {
		configPath, err = projectconfig.Path()
		if err != nil {
			return resolvedContextBinding{}, err
		}
	}
	config, err := projectconfig.Read(configPath)
	if err != nil {
		return resolvedContextBinding{}, err
	}
	apiURL := resolveAPIURL(nil, filepath.Join(agentDir, "moltnet.json"))
	if len(endpointOverride) > 0 {
		apiURL = endpointOverride[0]
	}
	if bindingName != "" {
		for _, candidate := range config.Bindings {
			if candidate.Name == bindingName && strings.TrimSuffix(candidate.APIURL, "/") != strings.TrimSuffix(apiURL, "/") {
				return resolvedContextBinding{}, fmt.Errorf("binding %q endpoint %q does not match selected API endpoint %q", bindingName, candidate.APIURL, apiURL)
			}
		}
	}
	project, err := projectconfig.Resolve(config, projectconfig.Options{APIURL: apiURL, ConfigPath: configPath, CWD: canonical, Native: true, Binding: bindingName})
	if err != nil {
		return resolvedContextBinding{}, err
	}
	if project != nil {
		binding := contextBinding{TeamID: project.TeamID, DiaryID: project.DiaryID}
		return resolvedContextBinding{Key: projectContextKey(project), Source: contextSourceLocation, Binding: &binding, Project: project}, nil
	}
	notice := func(w io.Writer) {
		var skipped []string
		for _, candidate := range config.Bindings {
			if strings.TrimSuffix(candidate.APIURL, "/") == strings.TrimSuffix(apiURL, "/") {
				continue
			}
			// Diagnostic only: aliases use the same canonical ancestor resolver. An
			// unavailable source outside the selected endpoint cannot provide a match.
			match, matchErr := projectconfig.Resolve(&projectconfig.Config{Version: config.Version, Bindings: []projectconfig.Binding{candidate}}, projectconfig.Options{ConfigPath: configPath, CWD: canonical, Native: true})
			if matchErr == nil && match != nil {
				skipped = append(skipped, fmt.Sprintf("%q (%s)", candidate.Name, candidate.APIURL))
			}
		}
		if len(skipped) > 0 {
			fmt.Fprintf(w, "notice: bindings %s match this folder but use another endpoint; selected endpoint is %q\n", strings.Join(skipped, ", "), apiURL)
		}
	}
	key := "dir:" + canonical
	if binding, ok := identityDefaultBinding(agentDir); ok {
		return resolvedContextBinding{Key: key, Source: contextSourceIdentityDefault, Binding: &binding, skippedEndpointNotice: notice}, nil
	}
	return resolvedContextBinding{Key: key, skippedEndpointNotice: notice}, nil
}

func activationCachePathForContext(agentDir, contextKey string) string {
	digest := sha256.Sum256([]byte(contextKey))
	return filepath.Join(agentDir, "activation-caches", hex.EncodeToString(digest[:])+".json")
}

// The key is hashed as an opaque cache identity, never parsed into fields.
// Quoting each component keeps separators in names and endpoints unambiguous.
func projectContextKey(project *projectconfig.Binding) string {
	return fmt.Sprintf("project:%q:%q:%q:%q", project.APIURL, project.TeamID, project.ProjectID, project.Name)
}

func (r resolvedContextBinding) writeSkippedEndpointNotice(w io.Writer) {
	if r.skippedEndpointNotice != nil {
		r.skippedEndpointNotice(w)
	}
}
