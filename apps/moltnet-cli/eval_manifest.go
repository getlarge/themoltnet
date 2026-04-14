package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/checklist"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/solver"
)

type evalChecklistCriteria struct {
	Type      string                `json:"type"`
	Context   string                `json:"context"`
	Checklist []checklist.Criterion `json:"checklist"`
}

// evalManifest is the per-scenario eval.json schema.
type evalManifest struct {
	Mode    string              `json:"mode"`
	Fixture evalManifestFixture `json:"fixture"`
	Pack    *evalManifestPack   `json:"pack,omitempty"`
	// Solver selects the dspy-go solver module (cot | react). Optional;
	// omitted or empty means "fall back to built-in default (cot)".
	// Validated by validateEvalManifest against solver.ParseKind.
	Solver string             `json:"solver,omitempty"`
	React  *evalManifestReact `json:"react,omitempty"`
}

type evalManifestFixture struct {
	Ref     string               `json:"ref,omitempty"`
	Exclude []string             `json:"exclude,omitempty"`
	Include []string             `json:"include,omitempty"`
	Inject  []evalManifestInject `json:"inject,omitempty"`
}

// evalManifestInject maps a file from the scenario directory into the
// worktree at an arbitrary target path. From is resolved relative to the
// scenario dir; To is resolved relative to the worktree root.
type evalManifestInject struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type evalManifestPack struct {
	Path string `json:"path"`
}

// evalManifestReact configures the ReAct solver for vivo eval scenarios.
// All fields are optional; zero values use built-in defaults.
// Ignored when solver is "cot". See
// docs/superpowers/specs/2026-04-13-react-solver-tool-registry-design.md.
type evalManifestReact struct {
	MaxIterations  int               `json:"max_iterations,omitempty"`
	BashTimeoutSec int               `json:"bash_timeout_sec,omitempty"`
	PassthroughEnv []string          `json:"passthrough_env,omitempty"`
	ExtraEnv       map[string]string `json:"extra_env,omitempty"`
}

// loadEvalManifest reads and JSON-parses eval.json from a scenario directory.
// It returns (nil, nil) if the file is absent (Phase 1 fallback: handled by
// validateScenario, which prints a warning). Strict unmarshaling rejects
// unknown top-level keys, but semantic validation of the mode value, fixture
// fields, and pack contents is intentionally deferred to validateScenario
// (Task 2) so this loader stays a pure parser.
func loadEvalManifest(scenarioDir string) (*evalManifest, error) {
	p := filepath.Join(scenarioDir, "eval.json")
	data, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading eval.json: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var m evalManifest
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("parsing eval.json: %w", err)
	}
	// Reject trailing content after the top-level object (e.g. `{...}{...}`
	// or stray garbage). Strict manifests should be a single JSON value.
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("parsing eval.json: unexpected trailing content after top-level object")
	}
	return &m, nil
}

// validateScenario validates task.md, criteria.json, and eval.json (if present).
// Returns the parsed evalManifest (nil if eval.json is absent — Phase 1 fallback).
// Hard-errors on malformed JSON, invalid criteria, or invalid eval.json semantics.
func validateScenario(dir string) (*evalManifest, error) {
	if err := validateTaskDir(dir); err != nil {
		return nil, err
	}

	criteriaData, err := os.ReadFile(filepath.Join(dir, "criteria.json"))
	if err != nil {
		return nil, fmt.Errorf("reading criteria.json: %w", err)
	}
	if err := validateCriteriaJSON(criteriaData); err != nil {
		return nil, fmt.Errorf("criteria.json in %s: %w", dir, err)
	}

	m, err := loadEvalManifest(dir)
	if err != nil {
		return nil, fmt.Errorf("eval.json in %s: %w", dir, err)
	}
	if m == nil {
		return nil, nil
	}
	if err := validateEvalManifest(m); err != nil {
		return nil, fmt.Errorf("eval.json in %s: %w", dir, err)
	}
	if err := validateFixtureInjectSources(dir, m); err != nil {
		return nil, fmt.Errorf("eval.json in %s: %w", dir, err)
	}
	return m, nil
}

func validateTaskDir(dir string) error {
	for _, name := range []string{"task.md", "criteria.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return fmt.Errorf("%s: missing %s", dir, name)
		}
	}
	return nil
}

func validateCriteriaJSON(data []byte) error {
	var c evalChecklistCriteria
	if err := json.Unmarshal(data, &c); err != nil {
		return fmt.Errorf("parse error: %w", err)
	}
	if c.Type != "" && c.Type != "weighted_checklist" {
		return fmt.Errorf("unsupported type %q (must be weighted_checklist)", c.Type)
	}
	if len(c.Checklist) == 0 {
		return fmt.Errorf("checklist must be non-empty")
	}
	var total float64
	for i, item := range c.Checklist {
		if strings.TrimSpace(item.Name) == "" {
			return fmt.Errorf("checklist[%d]: name must be non-empty", i)
		}
		if strings.TrimSpace(item.Description) == "" {
			return fmt.Errorf("checklist[%d]: description must be non-empty", i)
		}
		if item.MaxScore <= 0 {
			return fmt.Errorf("checklist[%d]: max_score must be positive, got %v", i, item.MaxScore)
		}
		total += item.MaxScore
	}
	if total != 100 {
		return fmt.Errorf("checklist max_score values must sum to 100, got %v", total)
	}
	return nil
}

func validateEvalManifest(m *evalManifest) error {
	switch m.Mode {
	case "vitro":
		if m.Fixture.Ref != "" {
			return fmt.Errorf("mode vitro: fixture.ref must be empty (ref is irrelevant in vitro mode)")
		}
		for i, g := range m.Fixture.Include {
			if strings.TrimSpace(g) == "" {
				return fmt.Errorf("fixture.include[%d]: must be non-empty", i)
			}
		}
	case "vivo":
		if strings.TrimSpace(m.Fixture.Ref) == "" {
			return fmt.Errorf("mode vivo: fixture.ref is required")
		}
	default:
		return fmt.Errorf("mode must be vitro or vivo, got %q", m.Mode)
	}
	for i, g := range m.Fixture.Exclude {
		if strings.TrimSpace(g) == "" {
			return fmt.Errorf("fixture.exclude[%d]: must be non-empty", i)
		}
	}
	if m.Pack != nil && strings.TrimSpace(m.Pack.Path) == "" {
		return fmt.Errorf("pack.path must be non-empty if pack is set")
	}
	for i, inj := range m.Fixture.Inject {
		if err := validateCleanRelPath(inj.From, fmt.Sprintf("fixture.inject[%d].from", i)); err != nil {
			return err
		}
		if err := validateCleanRelPath(inj.To, fmt.Sprintf("fixture.inject[%d].to", i)); err != nil {
			return err
		}
	}
	if m.Solver != "" {
		if _, err := solver.ParseKind(m.Solver); err != nil {
			return fmt.Errorf("solver: %w", err)
		}
	}
	if m.React != nil {
		if m.React.MaxIterations < 0 {
			return fmt.Errorf("react.max_iterations must be non-negative, got %d", m.React.MaxIterations)
		}
		if m.React.BashTimeoutSec < 0 {
			return fmt.Errorf("react.bash_timeout_sec must be non-negative, got %d", m.React.BashTimeoutSec)
		}
		for i, key := range m.React.PassthroughEnv {
			if strings.TrimSpace(key) == "" {
				return fmt.Errorf("react.passthrough_env[%d]: must be non-empty", i)
			}
		}
		for key := range m.React.ExtraEnv {
			if strings.TrimSpace(key) == "" {
				return fmt.Errorf("react.extra_env: keys must be non-empty")
			}
		}
	}
	return nil
}

// validateCleanRelPath checks that p is a non-empty, clean, relative path
// with no ".." or "." segments. fieldName is used in error messages.
func validateCleanRelPath(p, fieldName string) error {
	p = strings.TrimSpace(p)
	if p == "" {
		return fmt.Errorf("%s: must be non-empty", fieldName)
	}
	if filepath.IsAbs(p) {
		return fmt.Errorf("%s: must be a relative path, got %q", fieldName, p)
	}
	cleaned := filepath.Clean(filepath.ToSlash(p))
	if cleaned != filepath.ToSlash(p) {
		return fmt.Errorf("%s: must be a clean path (use %q instead of %q)", fieldName, cleaned, p)
	}
	for _, seg := range strings.Split(cleaned, "/") {
		if seg == ".." || seg == "." {
			return fmt.Errorf("%s: must not contain %q segment, got %q", fieldName, seg, p)
		}
	}
	return nil
}

// validateFixtureInjectSources checks that every fixture.inject[].from path
// exists on disk, is a file (not a directory), and resolves within the
// scenario directory.
func validateFixtureInjectSources(scenarioDir string, m *evalManifest) error {
	if m == nil {
		return nil
	}
	absScenario, err := filepath.Abs(scenarioDir)
	if err != nil {
		return fmt.Errorf("resolving scenario dir: %w", err)
	}
	for i, inj := range m.Fixture.Inject {
		absFrom, err := filepath.Abs(filepath.Join(scenarioDir, inj.From))
		if err != nil {
			return fmt.Errorf("fixture.inject[%d]: resolving from path: %w", i, err)
		}
		// Containment check: resolved path must be under scenario dir.
		if !strings.HasPrefix(absFrom, absScenario+string(filepath.Separator)) {
			return fmt.Errorf("fixture.inject[%d]: from %q escapes scenario directory", i, inj.From)
		}
		info, err := os.Stat(absFrom)
		if err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("fixture.inject[%d]: from %q not found in scenario dir", i, inj.From)
			}
			return fmt.Errorf("fixture.inject[%d]: stat from %q: %w", i, inj.From, err)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("fixture.inject[%d]: from %q must be a regular file, got %s", i, inj.From, info.Mode().Type())
		}
	}
	return nil
}

func parseChecklistCriteria(data []byte) (*evalChecklistCriteria, error) {
	var criteria evalChecklistCriteria
	if err := json.Unmarshal(data, &criteria); err != nil {
		return nil, fmt.Errorf("parsing criteria.json: %w", err)
	}
	if criteria.Type != "" && criteria.Type != "weighted_checklist" {
		return nil, fmt.Errorf("unsupported criteria type %q (must be weighted_checklist)", criteria.Type)
	}
	return &criteria, nil
}
