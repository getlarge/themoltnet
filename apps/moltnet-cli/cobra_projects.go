package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

func projectJSON(cmd *cobra.Command, value any) error {
	encoder := json.NewEncoder(cmd.OutOrStdout())
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func newProjectsCmd() *cobra.Command {
	root := &cobra.Command{Use: "projects", Short: "Shared team projects and machine-local workspace bindings"}
	for _, action := range []string{"create", "list", "get", "update", "archive"} {
		action := action
		var teamID, name, description, diaryID string
		var includeArchived, clearDiary bool
		var limit, offset int
		command := &cobra.Command{Use: action, Short: action + " a shared team project", Args: cobra.NoArgs}
		if action == "get" || action == "update" || action == "archive" {
			command.Use += " <project-id>"
			command.Args = cobra.ExactArgs(1)
		}
		command.Flags().StringVar(&teamID, "team-id", "", "Owning team UUID")
		_ = command.MarkFlagRequired("team-id")
		if action == "create" || action == "update" {
			command.Flags().StringVar(&name, "name", "", "Team-local project name")
			command.Flags().StringVar(&description, "description", "", "Project description")
			command.Flags().StringVar(&diaryID, "diary-id", "", "Default diary UUID")
			command.Flags().BoolVar(&clearDiary, "clear-diary", false, "Clear the default diary")
			command.MarkFlagsMutuallyExclusive("diary-id", "clear-diary")
			if action == "create" {
				_ = command.MarkFlagRequired("name")
			}
		}
		if action == "list" {
			command.Flags().BoolVar(&includeArchived, "include-archived", false, "Include archived projects")
			command.Flags().IntVar(&limit, "limit", 50, "Page size (1-100)")
			command.Flags().IntVar(&offset, "offset", 0, "Number of projects to skip")
		}
		command.RunE = func(cmd *cobra.Command, args []string) error {
			if action == "list" && (limit < 1 || limit > 100 || offset < 0) {
				return fmt.Errorf("limit must be between 1 and 100 and offset must be non-negative")
			}
			team, err := uuid.Parse(teamID)
			if err != nil {
				return fmt.Errorf("invalid team ID: %w", err)
			}
			var project uuid.UUID
			if len(args) > 0 {
				project, err = uuid.Parse(args[0])
				if err != nil {
					return fmt.Errorf("invalid project ID: %w", err)
				}
			}
			diary := moltnetapi.OptNilUUID{}
			if cmd.Flags().Changed("diary-id") {
				id, err := uuid.Parse(diaryID)
				if err != nil {
					return fmt.Errorf("invalid diary ID: %w", err)
				}
				diary = moltnetapi.NewOptNilUUID(id)
			}
			if clearDiary {
				diary.SetToNull()
			}
			credPath, _ := cmd.Flags().GetString("credentials")
			client, err := newAuthenticatedClient(resolveAPIURL(cmd, credPath), credPath, teamID)
			if err != nil {
				return err
			}
			var result any
			switch action {
			case "create":
				body := &moltnetapi.CreateProjectReq{Name: name, DefaultDiaryId: diary}
				if cmd.Flags().Changed("description") {
					body.Description = moltnetapi.NewOptNilString(description)
				}
				res, e := client.CreateProject(cmd.Context(), body, moltnetapi.CreateProjectParams{ID: team})
				err = e
				if err == nil {
					if value, ok := res.(*moltnetapi.CreateProjectCreated); ok {
						result = value
					} else {
						return formatAPIError(res)
					}
				}
			case "list":
				res, e := client.ListProjects(cmd.Context(), moltnetapi.ListProjectsParams{ID: team, IncludeArchived: moltnetapi.NewOptBool(includeArchived), Limit: moltnetapi.NewOptInt(limit), Offset: moltnetapi.NewOptInt(offset)})
				err = e
				if err == nil {
					if value, ok := res.(*moltnetapi.ListProjectsOK); ok {
						result = value
					} else {
						return formatAPIError(res)
					}
				}
			case "get":
				res, e := client.GetProject(cmd.Context(), moltnetapi.GetProjectParams{ID: team, ProjectId: project})
				err = e
				if err == nil {
					if value, ok := res.(*moltnetapi.GetProjectOK); ok {
						result = value
					} else {
						return formatAPIError(res)
					}
				}
			case "update", "archive":
				body := &moltnetapi.UpdateProjectReq{DefaultDiaryId: diary}
				if action == "archive" {
					body.Archived = moltnetapi.NewOptBool(true)
				}
				if cmd.Flags().Changed("name") {
					body.Name = moltnetapi.NewOptString(name)
				}
				if cmd.Flags().Changed("description") {
					body.Description = moltnetapi.NewOptNilString(description)
				}
				res, e := client.UpdateProject(cmd.Context(), moltnetapi.NewOptUpdateProjectReq(*body), moltnetapi.UpdateProjectParams{ID: team, ProjectId: project})
				err = e
				if err == nil {
					if value, ok := res.(*moltnetapi.UpdateProjectOK); ok {
						result = value
					} else {
						return formatAPIError(res)
					}
				}
			}
			if err != nil {
				return formatTransportError(err)
			}
			return projectJSON(cmd, result)
		}
		root.AddCommand(command)
	}
	root.AddCommand(newProjectBindingsCmd())
	return root
}

func newProjectBindingsCmd() *cobra.Command {
	var configPath string
	root := &cobra.Command{Use: "bindings", Short: "Manage trusted machine-local project folders"}
	root.PersistentFlags().StringVar(&configPath, "config-file", "", "Explicit project configuration JSON (default: central projects.json)")
	path := func() (string, error) {
		if configPath != "" {
			return filepath.Abs(configPath)
		}
		return projectconfig.Path()
	}
	list := &cobra.Command{Use: "list", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		p, err := path()
		if err != nil {
			return err
		}
		config, err := projectconfig.Read(p)
		if err != nil {
			return err
		}
		return projectJSON(cmd, config)
	}}
	var binding projectconfig.Binding
	set := &cobra.Command{Use: "set <name>", Short: "Save a folder and explicit workspace strategy", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		p, err := path()
		if err != nil {
			return err
		}
		binding.Name = args[0]
		binding.APIURL, _ = cmd.Flags().GetString("api-url")
		if binding.APIURL == "" {
			binding.APIURL = "https://api.themolt.net"
		}
		if binding.Source != "" {
			binding.Source, err = filepath.Abs(binding.Source)
			if err != nil {
				return err
			}
		}
		return projectconfig.Update(p, func(config *projectconfig.Config) error {
			for i, b := range config.Bindings {
				if b.Name == binding.Name {
					config.Bindings[i] = binding
					return nil
				}
			}
			config.Bindings = append(config.Bindings, binding)
			return nil
		})
	}}
	set.Flags().StringVar(&binding.TeamID, "team-id", "", "Project team ID")
	set.Flags().StringVar(&binding.ProjectID, "project-id", "", "Shared project ID")
	set.Flags().StringVar(&binding.DiaryID, "diary-id", "", "Local diary selection")
	set.Flags().StringVar(&binding.Source, "source", "", "Source directory (relative to caller CWD)")
	set.Flags().StringVar(&binding.Strategy, "strategy", "", "none, existing, git-worktree, or isolated-directory")
	set.Flags().BoolVar(&binding.Default, "default", false, "Use as this project's default binding")
	for _, name := range []string{"team-id", "project-id", "strategy"} {
		_ = set.MarkFlagRequired(name)
	}
	var selection projectconfig.Options
	var source, strategy string
	resolveCmd := &cobra.Command{Use: "resolve", Short: "Show effective non-secret selection without preparing or launching", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		p, err := path()
		if err != nil {
			return err
		}
		selection.ConfigPath = p
		if cmd.Flag("api-url").Changed {
			selection.APIURL, _ = cmd.Flags().GetString("api-url")
		}
		selection.CWD, err = os.Getwd()
		if err != nil {
			return err
		}
		if cmd.Flags().Changed("source") {
			selection.Overrides.Source = &source
		}
		if cmd.Flags().Changed("strategy") {
			selection.Overrides.Strategy = &strategy
		}
		config, err := projectconfig.Read(p)
		if err != nil {
			return err
		}
		result, err := projectconfig.Resolve(config, selection)
		if err != nil {
			return err
		}
		return projectJSON(cmd, result)
	}}
	resolveCmd.Flags().StringVar(&selection.Binding, "binding", "", "Select an explicit binding")
	resolveCmd.Flags().StringVar(&selection.ProjectID, "project-id", "", "Select a project")
	resolveCmd.Flags().StringVar(&selection.TeamID, "team-id", "", "Select a team")
	resolveCmd.Flags().BoolVar(&selection.Native, "native", false, "Resolve the most specific registered ancestor")
	resolveCmd.Flags().StringVar(&source, "source", "", "Run-only source override")
	resolveCmd.Flags().StringVar(&strategy, "strategy", "", "Run-only strategy override")
	remove := &cobra.Command{Use: "remove <name>", Short: "Remove a registration without deleting its folder", Args: cobra.ExactArgs(1), RunE: func(_ *cobra.Command, args []string) error {
		p, err := path()
		if err != nil {
			return err
		}
		return projectconfig.Update(p, func(c *projectconfig.Config) error {
			for i, b := range c.Bindings {
				if b.Name == args[0] {
					c.Bindings = append(c.Bindings[:i], c.Bindings[i+1:]...)
					return nil
				}
			}
			return fmt.Errorf("binding %s not found", args[0])
		})
	}}
	root.AddCommand(list, set, resolveCmd, remove)
	return root
}
