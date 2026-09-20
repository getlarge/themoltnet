package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
	"github.com/spf13/cobra"
)

// Each legacy location can name multiple explicitly selected checkouts.
// Team and diary are copied without reinterpretation; the API project is chosen
// by the operator because a legacy registration did not contain a project ID.
type projectMigrationPlan struct {
	Version int                                `json:"version"`
	Entries map[string][]projectconfig.Binding `json:"entries"`
}

func migrateProjectContexts(agentDir, destination string, plan projectMigrationPlan, validate func(projectconfig.Binding) error) error {
	if plan.Version != 1 {
		return fmt.Errorf("unsupported project migration plan version %d", plan.Version)
	}
	legacyPath := contextStorePath(agentDir)
	absolute, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	legacyAbsolute, err := filepath.Abs(legacyPath)
	if err != nil {
		return err
	}
	if resolved, e := filepath.EvalSymlinks(absolute); e == nil {
		absolute = resolved
	}
	if resolved, e := filepath.EvalSymlinks(legacyAbsolute); e == nil {
		legacyAbsolute = resolved
	}
	if absolute == legacyAbsolute {
		return fmt.Errorf("migration destination must differ from legacy file")
	}
	lock, err := safefile.Acquire(legacyPath)
	if err != nil {
		return err
	}
	defer lock.Close()
	if _, err := os.Lstat(legacyPath); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	legacy, err := readContextStore(agentDir)
	if err != nil {
		return err
	}
	if len(plan.Entries) != len(legacy.Contexts) {
		return fmt.Errorf("migration plan must cover every legacy registration exactly once")
	}
	keys := make([]string, 0, len(legacy.Contexts))
	for key := range legacy.Contexts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	additions := []projectconfig.Binding{}
	for _, key := range keys {
		old := legacy.Contexts[key]
		bindings, ok := plan.Entries[key]
		if !ok || len(bindings) == 0 {
			return fmt.Errorf("missing checkout mapping for %s", key)
		}
		for _, b := range bindings {
			if b.TeamID != old.TeamID || b.DiaryID != old.DiaryID {
				return fmt.Errorf("migration must preserve team and diary for %s", key)
			}
			if !filepath.IsAbs(b.Source) {
				return fmt.Errorf("migration source must be an absolute checkout path for %s", key)
			}
			source, err := filepath.EvalSymlinks(b.Source)
			if err != nil {
				return err
			}
			info, err := os.Stat(source)
			if err != nil {
				return err
			}
			if !info.IsDir() {
				return fmt.Errorf("source is not a directory: %s", b.Source)
			}
			switch {
			case strings.HasPrefix(key, "dir:"):
				previous, err := filepath.EvalSymlinks(strings.TrimPrefix(key, "dir:"))
				if err != nil {
					return err
				}
				if filepath.Clean(source) != filepath.Clean(previous) {
					return fmt.Errorf("source does not match legacy directory %s", key)
				}
			case strings.HasPrefix(key, "git:"):
				remote, ok := gitRemoteKeyAt(source)
				if !ok || remote != key {
					return fmt.Errorf("checkout does not match legacy remote %s", key)
				}
			default:
				return fmt.Errorf("unsupported legacy location %s", key)
			}
			if b.Strategy == "none" || b.Strategy == "" {
				return fmt.Errorf("choose an explicit workspace strategy for %s", key)
			}
			if err := validate(b); err != nil {
				return err
			}
			additions = append(additions, b)
		}
	}
	// One atomic destination update. Keep the legacy writer lock until deletion;
	// a retry after interruption recognizes identical bindings without duplicates.
	if err := projectconfig.Update(destination, func(c *projectconfig.Config) error {
		for _, b := range additions {
			found := false
			for _, existing := range c.Bindings {
				if existing.Name == b.Name {
					if !reflect.DeepEqual(existing, b) {
						return fmt.Errorf("binding name %q already exists with different settings", b.Name)
					}
					found = true
					break
				}
			}
			if !found {
				c.Bindings = append(c.Bindings, b)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	if err := os.Remove(legacyPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("projects saved; remove legacy file failed (safe to retry): %w", err)
	}
	return nil
}

func readProjectMigrationPlan(path string) (projectMigrationPlan, error) {
	var plan projectMigrationPlan
	data, err := safefile.ReadBoundedRegularFile(path, maxContextStoreBytes)
	if err != nil {
		return plan, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&plan); err != nil {
		return plan, err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return plan, fmt.Errorf("migration plan must contain one JSON object")
	}
	return plan, nil
}

func newProjectMigrateCmd() *cobra.Command {
	var identity, configPath, planPath string
	cmd := &cobra.Command{Use: "migrate", Short: "Port legacy contexts into projects.json and remove the legacy file", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		alias, err := resolveIdentityAlias(identity)
		if err != nil {
			return err
		}
		dir, err := identityDir(alias)
		if err != nil {
			return err
		}
		return migrateProjectsForCommand(cmd, dir, configPath, planPath)
	}}
	cmd.Flags().StringVar(&identity, "identity", "", "Identity whose legacy registrations are migrated")
	cmd.Flags().StringVar(&configPath, "config-file", "", "Destination project configuration")
	cmd.Flags().StringVar(&planPath, "plan", "", "Explicit versioned JSON checkout/project mapping for noninteractive migration")
	return cmd
}

func migrateProjectsForCommand(cmd *cobra.Command, dir, configPath, planPath string) error {
	if _, err := os.Lstat(contextStorePath(dir)); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if configPath == "" {
		var err error
		configPath, err = projectconfig.Path()
		if err != nil {
			return err
		}
	}
	legacy, err := readContextStore(dir)
	if err != nil {
		return err
	}
	plan := projectMigrationPlan{Version: 1, Entries: map[string][]projectconfig.Binding{}}
	if planPath != "" {
		plan, err = readProjectMigrationPlan(planPath)
		if err != nil {
			return err
		}
	} else if len(legacy.Contexts) > 0 {
		if !projectCommandInteractive(cmd) {
			return fmt.Errorf("legacy registrations need migration; run 'moltnet projects migrate --identity <alias>' in a terminal or supply --plan <mapping.json>")
		}
		reader := bufio.NewReader(cmd.InOrStdin())
		keys := make([]string, 0, len(legacy.Contexts))
		for key := range legacy.Contexts {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			fmt.Fprintf(cmd.OutOrStdout(), "Migrate %s (team %s, diary %s)\n", key, legacy.Contexts[key].TeamID, legacy.Contexts[key].DiaryID)
			for {
				source := strings.TrimPrefix(key, "dir:")
				if !strings.HasPrefix(key, "dir:") {
					source, err = promptText(cmd, reader, "Checkout folder (Git remotes can represent multiple checkouts)", "")
					if err != nil {
						return err
					}
				}
				source, err = filepath.Abs(source)
				if err != nil {
					return err
				}
				old := legacy.Contexts[key]
				b, err := guidedProjectRegistration(cmd, reader, dir, source, &old)
				if err != nil {
					return err
				}
				plan.Entries[key] = append(plan.Entries[key], b)
				if strings.HasPrefix(key, "dir:") {
					break
				}
				choice, err := promptChoice(cmd.OutOrStdout(), reader, "Register another checkout for this entry?", 2, func(i int) string { return []string{"No", "Yes"}[i] })
				if err != nil {
					return err
				}
				if choice == 0 {
					break
				}
			}
		}
	}
	if err := migrateProjectContexts(dir, configPath, plan, func(b projectconfig.Binding) error { return verifyProjectRegistration(cmd, dir, b) }); err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), "Migrated registrations to projects.json and removed contexts.json.")
	return nil
}
