// Package projectconfig reads machine-local, non-secret project bindings.
// Keep this contract in sync with libs/agent-config/src/project-bindings.ts.
package projectconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configdir"
	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

type ConfigError struct {
	Kind  string
	Cause error
}

func (e *ConfigError) Error() string { return e.Cause.Error() }
func (e *ConfigError) Unwrap() error { return e.Cause }
func errorKind(err error) string {
	var e *ConfigError
	if errors.As(err, &e) {
		return e.Kind
	}
	return ""
}
func classify(err error, kind string) error {
	if err == nil || errorKind(err) != "" {
		return err
	}
	return &ConfigError{Kind: kind, Cause: err}
}

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

func (o *Overrides) UnmarshalJSON(data []byte) error {
	type plain Overrides
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if _, err := exactFields(raw, "source", "strategy", "diaryId"); err != nil {
		return classify(err, "selection")
	}
	return json.Unmarshal(data, (*plain)(o))
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
	directory, err := configdir.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(directory, "projects.json"), nil
}
func isNonEmptyString(s string) bool {
	return utf8.ValidString(s) && strings.Trim(s, "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff") != "" && !strings.ContainsRune(s, 0)
}

const maxConfigBytes = 1 << 20
const maxHookTimeoutMS = 600000

var endpointPattern = regexp.MustCompile(`^(https?)://(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([1-9][0-9]{0,4}))?((?:/[A-Za-z0-9._~-]+)*/?)$`)
var numericHostLabelPattern = regexp.MustCompile(`^(?:[0-9]+|0x[0-9a-f]+)$`)
var hostLabelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

func endpoint(s string) (string, error) {
	fail := errors.New("apiUrl must be a canonical HTTP(S) endpoint; use HTTPS except for loopback")
	parts := endpointPattern.FindStringSubmatch(s)
	if parts == nil {
		return "", fail
	}
	scheme, host, port, path := parts[1], parts[2], parts[3], parts[4]
	if port != "" {
		number, _ := strconv.Atoi(port)
		if number > 65535 || (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
			return "", fail
		}
	}
	address, ipErr := netip.ParseAddr(strings.Trim(host, "[]"))
	if strings.HasPrefix(host, "[") {
		if ipErr != nil || !address.Is6() || address.Is4In6() || "["+address.String()+"]" != host {
			return "", fail
		}
	} else if numericHostLabelPattern.MatchString(host[strings.LastIndex(host, ".")+1:]) {
		if ipErr != nil || !address.Is4() {
			return "", fail
		}
	} else {
		for _, label := range strings.Split(host, ".") {
			if !hostLabelPattern.MatchString(label) {
				return "", fail
			}
		}
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." {
			return "", fail
		}
	}
	if scheme == "http" && host != "localhost" && host != "[::1]" && !(ipErr == nil && address.Is4() && address.IsLoopback()) {
		return "", fail
	}
	return strings.TrimSuffix(s, "/"), nil
}
func projectKey(b Binding) string {
	ep, _ := endpoint(b.APIURL)
	data, _ := json.Marshal([]string{ep, b.TeamID, b.ProjectID})
	return string(data)
}
func Validate(c *Config) (err error) {
	defer func() { err = classify(err, "validation") }()
	if c != nil && c.Version > 1 {
		return classify(errors.New("newer project config version; upgrade moltnet and the daemon/SDK"), "version")
	}
	if c == nil || c.Version != 1 {
		return classify(errors.New("invalid project config version; expected 1"), "version")
	}
	if c.Bindings == nil {
		return errors.New("bindings must be an array")
	}
	names := map[string]bool{}
	defaults := map[string]bool{}
	for index, b := range c.Bindings {
		if bindingErr := func() error {
			if !isNonEmptyString(b.Name) || !isNonEmptyString(b.APIURL) || !isNonEmptyString(b.TeamID) || !isNonEmptyString(b.ProjectID) {
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
				if !isNonEmptyString(b.Source) {
					return errors.New("source must be a non-empty string")
				}
			default:
				return errors.New("an explicit workspace strategy is required")
			}
			if b.DiaryID != "" && !isNonEmptyString(b.DiaryID) {
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
					if !isNonEmptyString(h.Command) {
						return errors.New("hook command must be non-empty")
					}
					if !filepath.IsAbs(h.Command) && (strings.ContainsAny(h.Command, "/\\") || h.Command == "." || h.Command == "..") {
						return errors.New("hook command must be an absolute path or a bare PATH name")
					}
					if h.Args == nil {
						return errors.New("hook args must be an array")
					}
					for _, arg := range h.Args {
						if !utf8.ValidString(arg) || strings.ContainsRune(arg, 0) {
							return errors.New("hook args cannot contain NUL")
						}
					}
					if h.TimeoutMS < 1 || h.TimeoutMS > maxHookTimeoutMS {
						return errors.New("hook timeoutMs must be between 1 and 600000")
					}
				}
			}
			return nil
		}(); bindingErr != nil {
			return fmt.Errorf("bindings[%d] (%s): %w", index, b.Name, bindingErr)
		}
	}
	return nil
}

// Decode through exact-name maps first: encoding/json struct decoding is case
// insensitive and conflates absent, null and empty values. Match the TS validator.
func exactFields(value any, allowed ...string) (map[string]any, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("expected an object")
	}
	for key := range object {
		found := false
		for _, field := range allowed {
			if key == field {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("unknown field: %s", key)
		}
	}
	return object, nil
}
func Parse(data []byte) (_ *Config, err error) {
	defer func() { err = classify(err, "validation") }()
	if err := validateJSONUnicode(data); err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("project config must be an object")
	}
	if version, ok := raw["version"].(float64); ok && version > 1 {
		return nil, classify(errors.New("newer project config version; upgrade moltnet and the daemon/SDK"), "version")
	}
	if raw["version"] != float64(1) {
		return nil, classify(errors.New("invalid project config version; expected 1"), "version")
	}
	if _, err := exactFields(raw, "version", "bindings"); err != nil {
		return nil, err
	}
	bindings, ok := raw["bindings"].([]any)
	if !ok {
		return nil, errors.New("bindings must be an array")
	}
	for index, value := range bindings {
		binding, err := exactFields(value, "name", "apiUrl", "teamId", "projectId", "diaryId", "source", "strategy", "default", "hooks")
		if err != nil {
			return nil, fmt.Errorf("bindings[%d]: %w", index, err)
		}
		encoded, err := json.Marshal(binding)
		if err != nil {
			return nil, fmt.Errorf("bindings[%d]: %w", index, err)
		}
		var typed Binding
		if err := json.Unmarshal(encoded, &typed); err != nil {
			return nil, fmt.Errorf("bindings[%d] (%v): %w", index, binding["name"], err)
		}
		for key, value := range binding {
			if value == nil {
				return nil, fmt.Errorf("bindings[%d].%s cannot be null", index, key)
			}
		}
		if diary, ok := binding["diaryId"]; ok {
			if text, ok := diary.(string); !ok || !isNonEmptyString(text) {
				return nil, fmt.Errorf("bindings[%d].diaryId must be a non-empty string", index)
			}
		}
		if binding["strategy"] == "none" {
			if _, ok := binding["source"]; ok {
				return nil, fmt.Errorf("bindings[%d]: no-workspace strategy cannot have source", index)
			}
		}
		if value, ok := binding["hooks"]; ok {
			hooks, err := exactFields(value, "afterCreate", "beforeRun")
			if err != nil {
				return nil, fmt.Errorf("bindings[%d].hooks: %w", index, err)
			}
			for phase, value := range hooks {
				hook, err := exactFields(value, "command", "args", "timeoutMs")
				if err != nil {
					return nil, fmt.Errorf("bindings[%d].hooks.%s: %w", index, phase, err)
				}
				args, ok := hook["args"].([]any)
				if !ok {
					return nil, fmt.Errorf("bindings[%d].hooks.%s.args must be an array", index, phase)
				}
				for _, arg := range args {
					if _, ok := arg.(string); !ok {
						return nil, fmt.Errorf("bindings[%d].hooks.%s.args must be strings", index, phase)
					}
				}
			}
		}
	}
	// Re-encoding gives integral JSON numbers one representation (1.0 and 1e3
	// are numbers, not different values). Struct decode still checks value types.
	canonical, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var config Config
	if err := json.Unmarshal(canonical, &config); err != nil {
		return nil, err
	}
	if err := Validate(&config); err != nil {
		return nil, err
	}
	return &config, nil
}
func Read(path string) (*Config, error) {
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return &Config{Version: 1, Bindings: []Binding{}}, nil
	}
	data, err := safefile.ReadBoundedRegularFileChecked(path, maxConfigBytes, validateOwner)
	if err != nil {
		return nil, classify(err, "io")
	}
	config, err := Parse(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return config, nil
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
	if info, err := os.Lstat(path); err == nil {
		if err := validateWriteOwner(info); err != nil {
			return &ConfigError{Kind: "io", Cause: fmt.Errorf("%s: %w", path, err)}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
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
	for index := range c.Bindings {
		c.Bindings[index].APIURL, _ = endpoint(c.Bindings[index].APIURL)
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if len(data) > maxConfigBytes {
		return errors.New("project config exceeds 1 MiB")
	}
	return lock.Write(data)
}
func canonicalDirectory(path string) (string, error) {
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
	return canonicalDiskPath(canonical)
}
func resolvePath(base, path string) string {
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
func Resolve(c *Config, o Options) (_ *Binding, err error) {
	defer func() { err = classify(err, "selection") }()
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
		candidates, err = selectAncestors(candidates, o.CWD, base)
		if err != nil {
			return nil, err
		}
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
		names := []string{}
		for _, b := range candidates {
			names = append(names, b.Name)
		}
		return nil, fmt.Errorf("ambiguous project binding: %s; select a binding explicitly", strings.Join(names, ", "))
	}
	return applyOverrides(candidates[0], o, base)
}

func applyOverrides(binding Binding, o Options, base string) (*Binding, error) {
	var err error
	// Clone hooks too: a caller must not mutate saved defaults through the result.
	encoded, _ := json.Marshal(binding)
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
		if !isNonEmptyString(*o.Overrides.DiaryID) {
			return nil, classify(errors.New("diaryId override must be a non-empty string"), "validation")
		}
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
		result.Source, err = canonicalDirectory(resolvePath(base, result.Source))
		if err != nil {
			return nil, err
		}
	}
	result.APIURL, _ = endpoint(result.APIURL)
	return &result, nil
}

func selectAncestors(candidates []Binding, cwdPath, base string) ([]Binding, error) {
	cwd, err := canonicalDirectory(cwdPath)
	if err != nil {
		return nil, err
	}
	selected := []Binding{}
	pathLength := -1
	for _, b := range candidates {
		if b.Source == "" {
			continue
		}
		path, err := canonicalDirectory(resolvePath(base, b.Source))
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("registered source for binding %s is unavailable: %s", b.Name, b.Source)
		}
		if err != nil {
			return nil, err
		}
		if ancestor(path, cwd) {
			if len(path) > pathLength {
				selected = []Binding{}
				pathLength = len(path)
			}
			if len(path) == pathLength {
				selected = append(selected, b)
			}
		}
	}
	return selected, nil
}
