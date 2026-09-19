// Package projectconfig reads machine-local, non-secret project bindings.
// Keep this contract in sync with libs/agent-config/src/project-bindings.ts.
package projectconfig

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

type Hook struct {
	Command   string   `json:"command"`
	Args      []string `json:"args"`
	TimeoutMS int      `json:"timeoutMs"`
}
type Hooks struct {
	AfterCreate *Hook `json:"afterCreate,omitempty"`
	BeforeRun   *Hook `json:"beforeRun,omitempty"`
}
type Binding struct {
	Name      string `json:"name"`
	APIURL    string `json:"apiUrl"`
	TeamID    string `json:"teamId"`
	ProjectID string `json:"projectId"`
	DiaryID   string `json:"diaryId,omitempty"`
	Source    string `json:"source,omitempty"`
	Strategy  string `json:"strategy"`
	Default   bool   `json:"default,omitempty"`
	Hooks     *Hooks `json:"hooks,omitempty"`
}
type Config struct {
	Version  int       `json:"version"`
	Bindings []Binding `json:"bindings"`
}
type Overrides struct {
	Source   *string `json:"source,omitempty"`
	Strategy *string `json:"strategy,omitempty"`
	DiaryID  *string `json:"diaryId,omitempty"`
}
type Options struct {
	ConfigPath string    `json:"configPath,omitempty"`
	CWD        string    `json:"cwd"`
	Binding    string    `json:"binding,omitempty"`
	APIURL     string    `json:"apiUrl,omitempty"`
	TeamID     string    `json:"teamId,omitempty"`
	ProjectID  string    `json:"projectId,omitempty"`
	Native     bool      `json:"native,omitempty"`
	Overrides  Overrides `json:"overrides,omitempty"`
}

func Path() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "moltnet", "projects.json"), nil
}
func nonempty(s string) bool { return strings.TrimSpace(s) != "" && !strings.ContainsRune(s, 0) }
func endpoint(s string) (string, error) {
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("apiUrl must be an HTTP(S) endpoint without credentials, query or fragment")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		u.Host = u.Hostname()
		if strings.Contains(u.Host, ":") {
			u.Host = "[" + u.Host + "]"
		}
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}
func projectKey(b Binding) string {
	ep, _ := endpoint(b.APIURL)
	data, _ := json.Marshal([]string{ep, b.TeamID, b.ProjectID})
	return string(data)
}
func Validate(c *Config) error {
	if c == nil || c.Version != 1 {
		return errors.New("unsupported project config version; expected 1")
	}
	if c.Bindings == nil {
		return errors.New("bindings must be an array")
	}
	names := map[string]bool{}
	defaults := map[string]bool{}
	for _, b := range c.Bindings {
		if !nonempty(b.Name) || !nonempty(b.APIURL) || !nonempty(b.TeamID) || !nonempty(b.ProjectID) {
			return errors.New("name, apiUrl, teamId and projectId must be non-empty strings")
		}
		if names[b.Name] {
			return fmt.Errorf("duplicate binding name: %s", b.Name)
		}
		names[b.Name] = true
		if _, err := endpoint(b.APIURL); err != nil {
			return err
		}
		switch b.Strategy {
		case "none":
			if b.Source != "" || b.Hooks != nil {
				return errors.New("no-workspace strategy cannot have source or hooks")
			}
		case "existing", "git-worktree", "isolated-directory":
			if !nonempty(b.Source) {
				return errors.New("source must be a non-empty string")
			}
		default:
			return errors.New("an explicit workspace strategy is required")
		}
		if b.DiaryID != "" && !nonempty(b.DiaryID) {
			return errors.New("diaryId must be a non-empty string")
		}
		if b.Default {
			key := projectKey(b)
			if defaults[key] {
				return errors.New("multiple default bindings for the same project")
			}
			defaults[key] = true
		}
		if b.Hooks != nil {
			for _, h := range []*Hook{b.Hooks.AfterCreate, b.Hooks.BeforeRun} {
				if h == nil {
					continue
				}
				if !nonempty(h.Command) {
					return errors.New("hook command must be non-empty")
				}
				if h.Args == nil {
					return errors.New("hook args must be an array")
				}
				for _, arg := range h.Args {
					if strings.ContainsRune(arg, 0) {
						return errors.New("hook args cannot contain NUL")
					}
				}
				if h.TimeoutMS < 1 || h.TimeoutMS > 600000 {
					return errors.New("hook timeoutMs must be between 1 and 600000")
				}
			}
		}
	}
	return nil
}
func Parse(data []byte) (*Config, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if _, ok := raw["contexts"]; ok {
		return nil, errors.New("legacy contexts require migration: explicitly register each checkout path in projects.json")
	}
	var bindings []map[string]json.RawMessage
	if err := json.Unmarshal(raw["bindings"], &bindings); err != nil {
		return nil, err
	}
	for _, binding := range bindings {
		for key, value := range binding {
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return nil, fmt.Errorf("%s cannot be null", key)
			}
		}
		if value, ok := binding["diaryId"]; ok {
			var diary string
			if err := json.Unmarshal(value, &diary); err != nil || !nonempty(diary) {
				return nil, errors.New("diaryId must be a non-empty string")
			}
		}
		if string(binding["strategy"]) == `"none"` {
			if _, ok := binding["source"]; ok {
				return nil, errors.New("no-workspace strategy cannot have source")
			}
		}
		if value, ok := binding["hooks"]; ok {
			var hooks map[string]json.RawMessage
			if err := json.Unmarshal(value, &hooks); err != nil {
				return nil, err
			}
			for _, hook := range hooks {
				if bytes.Equal(bytes.TrimSpace(hook), []byte("null")) {
					return nil, errors.New("hook cannot be null")
				}
			}
		}
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	var c Config
	if err := d.Decode(&c); err != nil {
		return nil, err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return nil, errors.New("expected one project config document")
	}
	if err := Validate(&c); err != nil {
		return nil, err
	}
	return &c, nil
}
func Read(path string) (*Config, error) {
	data, err := safefile.ReadBoundedRegularFile(path, 1<<20)
	if errors.Is(err, os.ErrNotExist) {
		return &Config{Version: 1, Bindings: []Binding{}}, nil
	}
	if err != nil {
		return nil, err
	}
	return Parse(data)
}
func Update(path string, mutate func(*Config) error) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	lock, err := safefile.Acquire(path)
	if err != nil {
		return err
	}
	defer lock.Close()
	c, err := Read(path)
	if err != nil {
		return err
	}
	if err := mutate(c); err != nil {
		return err
	}
	if err := Validate(c); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if len(data) > 1<<20 {
		return errors.New("project config exceeds 1 MiB")
	}
	return lock.Write(data)
}
func directory(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	canonical, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canonical)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("workspace source is not a directory: %s", path)
	}
	return canonical, nil
}
func at(base, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(base, path)
}
func ancestor(parent, child string) bool {
	r, err := filepath.Rel(parent, child)
	return err == nil && !filepath.IsAbs(r) && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator))
}

// Resolve selects only. It does not resolve credentials, contact an API or run hooks.
func Resolve(c *Config, o Options) (*Binding, error) {
	if err := Validate(c); err != nil {
		return nil, err
	}
	path := o.ConfigPath
	if path == "" {
		var err error
		path, err = Path()
		if err != nil {
			return nil, err
		}
	}
	base, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	requestedEndpoint := ""
	if o.APIURL != "" {
		requestedEndpoint, err = endpoint(o.APIURL)
		if err != nil {
			return nil, err
		}
	}
	candidates := []Binding{}
	for _, b := range c.Bindings {
		ep, _ := endpoint(b.APIURL)
		if (requestedEndpoint == "" || ep == requestedEndpoint) && (o.TeamID == "" || b.TeamID == o.TeamID) && (o.ProjectID == "" || b.ProjectID == o.ProjectID) {
			candidates = append(candidates, b)
		}
	}
	if o.Binding != "" {
		selected := []Binding{}
		for _, b := range candidates {
			if b.Name == o.Binding {
				selected = append(selected, b)
			}
		}
		candidates = selected
		if len(candidates) == 0 {
			return nil, fmt.Errorf("binding %s does not match requested project, team or endpoint", o.Binding)
		}
	} else if o.Native {
		cwd, err := directory(o.CWD)
		if err != nil {
			return nil, err
		}
		selected := []Binding{}
		depth := -1
		for _, b := range candidates {
			if b.Source == "" {
				continue
			}
			path, err := directory(at(base, b.Source))
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if ancestor(path, cwd) {
				if len(path) > depth {
					selected = []Binding{}
					depth = len(path)
				}
				if len(path) == depth {
					selected = append(selected, b)
				}
			}
		}
		candidates = selected
	} else if len(candidates) > 1 {
		projects := map[string]bool{}
		defaults := []Binding{}
		for _, b := range candidates {
			projects[projectKey(b)] = true
			if b.Default {
				defaults = append(defaults, b)
			}
		}
		if len(projects) == 1 && len(defaults) == 1 {
			candidates = defaults
		}
	}
	if len(candidates) == 0 {
		if o.ProjectID != "" {
			return nil, errors.New("no matching project binding; register a local folder or select a binding")
		}
		return nil, nil
	}
	if len(candidates) != 1 {
		return nil, errors.New("ambiguous project binding; select a binding explicitly")
	}
	// Clone hooks too: a caller must not mutate saved defaults through the result.
	encoded, _ := json.Marshal(candidates[0])
	var result Binding
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	if o.Overrides.Source != nil {
		result.Source = *o.Overrides.Source
		base = o.CWD
	}
	if o.Overrides.Strategy != nil {
		result.Strategy = *o.Overrides.Strategy
	}
	if o.Overrides.DiaryID != nil {
		result.DiaryID = *o.Overrides.DiaryID
	}
	if result.Strategy == "none" {
		if o.Overrides.Source != nil {
			return nil, errors.New("no-workspace override cannot specify a source")
		}
		result.Source = ""
		result.Hooks = nil
	}
	if err := Validate(&Config{Version: 1, Bindings: []Binding{result}}); err != nil {
		return nil, err
	}
	if result.Source != "" {
		result.Source, err = directory(at(base, result.Source))
		if err != nil {
			return nil, err
		}
	}
	result.APIURL, _ = endpoint(result.APIURL)
	return &result, nil
}
