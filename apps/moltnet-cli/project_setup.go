package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

func promptText(cmd *cobra.Command, reader *bufio.Reader, title, initial string) (string, error) {
	fmt.Fprint(cmd.OutOrStdout(), title)
	if initial != "" {
		fmt.Fprintf(cmd.OutOrStdout(), " [%s]", initial)
	}
	fmt.Fprint(cmd.OutOrStdout(), ": ")
	line, err := reader.ReadString('\n')
	if err != nil {
		if errors.Is(err, io.EOF) {
			return "", fmt.Errorf("project setup cancelled: input ended")
		}
		return "", err
	}
	value := strings.TrimSpace(line)
	if value == "" {
		value = initial
	}
	if value == "" {
		return "", fmt.Errorf("%s is required", title)
	}
	return value, nil
}

func guidedProjectRegistration(cmd *cobra.Command, reader *bufio.Reader, dir, source string, old *contextBinding) (projectconfig.Binding, error) {
	b := projectconfig.Binding{Source: source}
	if old != nil {
		b.TeamID, b.DiaryID = old.TeamID, old.DiaryID
	} else {
		var err error
		b.TeamID, b.DiaryID, err = guidedTeamDiaryWithReader(cmd, dir, reader)
		if err != nil {
			return b, err
		}
	}
	credentials := filepath.Join(dir, "moltnet.json")
	creds, err := ReadConfigFrom(credentials)
	if err != nil {
		return b, err
	}
	b.APIURL = resolveAPIURLFromCredentials("", false, creds)
	client, err := newAuthenticatedClient(b.APIURL, credentials, b.TeamID)
	if err != nil {
		return b, err
	}
	team, err := uuid.Parse(b.TeamID)
	if err != nil {
		return b, err
	}
	projects := []moltnetapi.ListProjectsOKItemsItem{}
	offset := 0
	for {
		response, err := client.ListProjects(cmd.Context(), moltnetapi.ListProjectsParams{ID: team, Limit: moltnetapi.NewOptInt(100), Offset: moltnetapi.NewOptInt(offset)})
		if err != nil {
			return b, formatTransportError(err)
		}
		page, ok := response.(*moltnetapi.ListProjectsOK)
		if !ok {
			return b, formatAPIError(response)
		}
		for _, p := range page.Items {
			if !p.Archived {
				projects = append(projects, p)
			}
		}
		if page.NextOffset.Null {
			break
		}
		if page.NextOffset.Value <= offset {
			return b, fmt.Errorf("project catalogue returned a non-advancing page")
		}
		offset = page.NextOffset.Value
	}
	choice, err := promptChoice(cmd.OutOrStdout(), reader, "Choose a shared project", len(projects)+2, func(i int) string {
		if i == len(projects) {
			return "Create a project"
		}
		if i == len(projects)+1 {
			return "Cancel"
		}
		return projects[i].Name + " (" + projects[i].ID.String() + ")"
	})
	if err != nil {
		return b, err
	}
	if choice == len(projects)+1 {
		return b, fmt.Errorf("project setup cancelled")
	}
	if choice == len(projects) {
		name, err := promptText(cmd, reader, "Project name", filepath.Base(source))
		if err != nil {
			return b, err
		}
		diary, err := uuid.Parse(b.DiaryID)
		if err != nil {
			return b, err
		}
		response, err := client.CreateProject(cmd.Context(), &moltnetapi.CreateProjectReq{Name: name, DefaultDiaryId: moltnetapi.NewOptNilUUID(diary)}, moltnetapi.CreateProjectParams{ID: team})
		if err != nil {
			return b, formatTransportError(err)
		}
		created, ok := response.(*moltnetapi.CreateProjectCreated)
		if !ok {
			return b, formatAPIError(response)
		}
		b.ProjectID = created.ID.String()
	} else {
		b.ProjectID = projects[choice].ID.String()
	}
	b.Name, err = promptText(cmd, reader, "Local binding name", filepath.Base(source))
	if err != nil {
		return b, err
	}
	choice, err = promptChoice(cmd.OutOrStdout(), reader, "Default workspace behavior", 3, func(i int) string { return []string{"Work here", "Prepare an isolated workspace", "Cancel"}[i] })
	if err != nil {
		return b, err
	}
	switch choice {
	case 0:
		b.Strategy = "existing"
	case 1:
		b.Strategy = "isolated-directory"
		if isGitCheckout(source) {
			b.Strategy = "git-worktree"
		}
	case 2:
		return b, fmt.Errorf("project setup cancelled")
	}
	fmt.Fprintln(cmd.OutOrStdout(), "Native start launches in the source folder; this workspace default applies to workspace executions.")
	return b, nil
}

func isGitCheckout(source string) bool {
	// A local .git entry exists at a checkout root; worktrees use a file.
	_, err := os.Stat(filepath.Join(source, ".git"))
	return err == nil
}

func verifyProjectRegistration(cmd *cobra.Command, dir string, b projectconfig.Binding) error {
	team, err := uuid.Parse(b.TeamID)
	if err != nil {
		return err
	}
	project, err := uuid.Parse(b.ProjectID)
	if err != nil {
		return err
	}
	diary, err := uuid.Parse(b.DiaryID)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(b.APIURL, filepath.Join(dir, "moltnet.json"), b.TeamID)
	if err != nil {
		return err
	}
	response, err := client.GetProject(cmd.Context(), moltnetapi.GetProjectParams{ID: team, ProjectId: project})
	if err != nil {
		return formatTransportError(err)
	}
	p, ok := response.(*moltnetapi.GetProjectOK)
	if !ok {
		return formatAPIError(response)
	}
	if p.Archived || p.TeamId != team {
		return fmt.Errorf("project must be active and belong to the selected team")
	}
	res, err := client.GetDiary(cmd.Context(), moltnetapi.GetDiaryParams{ID: diary})
	if err != nil {
		return formatTransportError(err)
	}
	d, ok := res.(*moltnetapi.DiaryCatalog)
	if !ok {
		return formatAPIError(res)
	}
	if d.TeamId != team {
		return fmt.Errorf("diary does not belong to the selected team")
	}
	return nil
}

func setupProjectForCommand(cmd *cobra.Command, dir, configPath, source string) error {
	if !projectCommandInteractive(cmd) {
		return fmt.Errorf("project setup needs a terminal; use 'moltnet projects bindings set' for noninteractive registration")
	}
	if configPath == "" {
		var err error
		configPath, err = projectconfig.Path()
		if err != nil {
			return err
		}
	}
	source, err := canonicalDirectory(source)
	if err != nil {
		return err
	}
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("source is not a directory")
	}
	b, err := guidedProjectRegistration(cmd, bufio.NewReader(cmd.InOrStdin()), dir, source, nil)
	if err != nil {
		return err
	}
	if err := verifyProjectRegistration(cmd, dir, b); err != nil {
		return err
	}
	return projectconfig.Update(configPath, func(c *projectconfig.Config) error {
		for _, existing := range c.Bindings {
			if existing.Name == b.Name {
				return fmt.Errorf("binding %q already exists; use an explicit bindings set to replace it", b.Name)
			}
		}
		c.Bindings = append(c.Bindings, b)
		return nil
	})
}

func newProjectSetupCmd() *cobra.Command {
	var identity, configPath, source string
	cmd := &cobra.Command{Use: "setup", Short: "Interactively register a folder, team, diary and shared project", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		alias, err := resolveIdentityAlias(identity)
		if err != nil {
			return err
		}
		dir, err := identityDir(alias)
		if err != nil {
			return err
		}
		if err := migrateProjectsForCommand(cmd, dir, configPath, ""); err != nil {
			return err
		}
		return setupProjectForCommand(cmd, dir, configPath, source)
	}}
	cmd.Flags().StringVar(&identity, "identity", "", "Central identity alias")
	cmd.Flags().StringVar(&configPath, "config-file", "", "Project configuration file")
	cmd.Flags().StringVar(&source, "source", "", "Folder to register (defaults to current folder)")
	return cmd
}
