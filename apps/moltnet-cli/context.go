package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

type contextCommandOptions struct {
	Identity  string
	TeamID    string
	DiaryID   string
	Directory string
	Default   bool
	JSON      bool
}

type contextShowResult struct {
	ContextKey      string `json:"contextKey"`
	Identity        string `json:"identity"`
	TeamID          string `json:"teamId,omitempty"`
	DiaryID         string `json:"diaryId,omitempty"`
	Source          string `json:"source,omitempty"`
	LegacyAvailable bool   `json:"legacyAvailable,omitempty"`
}

func contextIdentity(identity string) (string, string, error) {
	alias, err := resolveIdentityAlias(identity)
	if err != nil {
		return "", "", err
	}
	dir, err := identityDir(alias)
	return alias, dir, err
}

func runContextShowCmd(cmd *cobra.Command, opts contextCommandOptions) error {
	alias, agentDir, err := contextIdentity(opts.Identity)
	if err != nil {
		return err
	}
	resolved, err := resolveContextBinding(agentDir, opts.Directory)
	if err != nil {
		return err
	}
	result := contextShowResult{ContextKey: resolved.Key, Identity: alias, Source: resolved.Source}
	if resolved.Binding != nil {
		result.TeamID = resolved.Binding.TeamID
		result.DiaryID = resolved.Binding.DiaryID
	} else {
		env, _ := parseEnvFile(filepath.Join(agentDir, "env"))
		result.LegacyAvailable = env["MOLTNET_TEAM_ID"] != "" || env["MOLTNET_DIARY_ID"] != ""
	}
	if opts.JSON {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(result)
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Context:  %s\nIdentity: %s\n", result.ContextKey, result.Identity)
	if resolved.Binding == nil {
		fmt.Fprintln(cmd.OutOrStdout(), "Binding:  none")
		if result.LegacyAvailable {
			fmt.Fprintln(cmd.OutOrStdout(), "Legacy team/diary settings are available. Run 'moltnet context set' to bind them explicitly; they were not promoted automatically.")
		}
		return nil
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Source:   %s\nTeam:     %s\nDiary:    %s\n", result.Source, result.TeamID, result.DiaryID)
	return nil
}

func runContextSetCmd(cmd *cobra.Command, opts contextCommandOptions) error {
	if opts.Default && opts.Directory != "" {
		return fmt.Errorf("--default and --directory are mutually exclusive")
	}
	alias, agentDir, err := contextIdentity(opts.Identity)
	if err != nil {
		return err
	}
	if (opts.TeamID == "") != (opts.DiaryID == "") {
		return fmt.Errorf("--team-id and --diary-id must be provided together")
	}
	if opts.TeamID == "" {
		if !contextCommandInteractive(cmd) {
			return fmt.Errorf("context binding requires --team-id and --diary-id in non-interactive use")
		}
		opts.TeamID, opts.DiaryID, err = guidedContextBinding(cmd, agentDir)
		if err != nil {
			return err
		}
	}
	resolved, err := setContextBinding(agentDir, "", contextBinding{TeamID: opts.TeamID, DiaryID: opts.DiaryID}, opts.Default, opts.Directory)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Set %s context %s for %s (team %s, diary %s)\n", resolved.Source, resolved.Key, alias, opts.TeamID, opts.DiaryID)
	return nil
}

func runContextClearCmd(cmd *cobra.Command, opts contextCommandOptions) error {
	if opts.Default && opts.Directory != "" {
		return fmt.Errorf("--default and --directory are mutually exclusive")
	}
	alias, agentDir, err := contextIdentity(opts.Identity)
	if err != nil {
		return err
	}
	key, err := clearContextBinding(agentDir, "", opts.Default, opts.Directory)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Cleared context %s for %s\n", key, alias)
	return nil
}

func contextCommandInteractive(cmd *cobra.Command) bool {
	file, ok := cmd.InOrStdin().(*os.File)
	return ok && term.IsTerminal(int(file.Fd()))
}

func guidedContextBinding(cmd *cobra.Command, agentDir string) (string, string, error) {
	legacy, _ := parseEnvFile(filepath.Join(agentDir, "env"))
	legacyTeam := strings.TrimSpace(legacy["MOLTNET_TEAM_ID"])
	legacyDiary := strings.TrimSpace(legacy["MOLTNET_DIARY_ID"])
	reader := bufio.NewReader(cmd.InOrStdin())
	if legacyTeam != "" && legacyDiary != "" {
		choice, err := promptChoice(cmd.OutOrStdout(), reader, "Legacy team and diary settings were found", 2, func(index int) string {
			if index == 0 {
				return "Use them for this binding"
			}
			return "Choose a binding online"
		})
		if err != nil {
			return "", "", err
		}
		if choice == 0 {
			return legacyTeam, legacyDiary, nil
		}
	}
	credentialsPath := filepath.Join(agentDir, "moltnet.json")
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		return "", "", err
	}
	client, err := newAuthenticatedClient(resolveAPIURLFromCredentials("", false, creds), credentialsPath)
	if err != nil {
		return "", "", err
	}
	teamsResponse, err := client.ListTeams(context.Background(), moltnetapi.ListTeamsParams{})
	if err != nil {
		return "", "", fmt.Errorf("list teams: %w", formatTransportError(err))
	}
	teams, ok := teamsResponse.(*moltnetapi.ListTeamsOK)
	if !ok {
		return "", "", formatAPIError(teamsResponse)
	}
	teamIndex, err := promptChoice(cmd.OutOrStdout(), reader, "Choose a team", len(teams.Items), func(index int) string {
		return fmt.Sprintf("%s (%s)", teams.Items[index].Name, teams.Items[index].ID)
	})
	if err != nil {
		return "", "", err
	}
	teamID := teams.Items[teamIndex].ID

	diariesResponse, err := client.ListDiaries(context.Background(), moltnetapi.ListDiariesParams{})
	if err != nil {
		return "", "", fmt.Errorf("list diaries: %w", formatTransportError(err))
	}
	diaries, ok := diariesResponse.(*moltnetapi.DiaryCatalogList)
	if !ok {
		return "", "", formatAPIError(diariesResponse)
	}
	teamDiaries := make([]moltnetapi.DiaryCatalog, 0)
	matchingDiaries := make([]moltnetapi.DiaryCatalog, 0, 1)
	suggested := contextSuggestedName()
	for _, diary := range diaries.Items {
		if diary.TeamId == teamID {
			teamDiaries = append(teamDiaries, diary)
			if strings.EqualFold(diary.Name, suggested) {
				matchingDiaries = append(matchingDiaries, diary)
			}
		}
	}
	if len(matchingDiaries) == 1 {
		diary := matchingDiaries[0]
		fmt.Fprintf(cmd.OutOrStdout(), "Using matching diary %q (%s).\n", diary.Name, diary.ID)
		return teamID.String(), diary.ID.String(), nil
	}
	if len(teamDiaries) > 0 {
		diaryIndex, err := promptChoice(cmd.OutOrStdout(), reader, "Choose a diary", len(teamDiaries)+1, func(index int) string {
			if index == len(teamDiaries) {
				return fmt.Sprintf("Create %q", suggested)
			}
			return fmt.Sprintf("%s (%s)", teamDiaries[index].Name, teamDiaries[index].ID)
		})
		if err != nil {
			return "", "", err
		}
		if diaryIndex < len(teamDiaries) {
			return teamID.String(), teamDiaries[diaryIndex].ID.String(), nil
		}
	} else {
		createIndex, err := promptChoice(cmd.OutOrStdout(), reader, "No diary is configured for this team", 2, func(index int) string {
			if index == 0 {
				return fmt.Sprintf("Create %q", suggested)
			}
			return "Cancel"
		})
		if err != nil {
			return "", "", err
		}
		if createIndex != 0 {
			return "", "", fmt.Errorf("context setup cancelled")
		}
	}
	created, err := client.CreateDiary(context.Background(), &moltnetapi.CreateDiaryReq{
		Name:       suggested,
		Visibility: moltnetapi.OptCreateDiaryReqVisibility{Set: true, Value: moltnetapi.CreateDiaryReqVisibilityMoltnet},
	}, moltnetapi.CreateDiaryParams{XMoltnetTeamID: teamID})
	if err != nil {
		return "", "", fmt.Errorf("create diary: %w", formatTransportError(err))
	}
	diary, ok := created.(*moltnetapi.DiaryCatalog)
	if !ok {
		return "", "", formatAPIError(created)
	}
	return teamID.String(), diary.ID.String(), nil
}

func promptChoice(out io.Writer, reader *bufio.Reader, title string, count int, label func(int) string) (int, error) {
	if count == 0 {
		return 0, fmt.Errorf("%s: no choices available", title)
	}
	fmt.Fprintln(out, title+":")
	for index := 0; index < count; index++ {
		fmt.Fprintf(out, "  %d. %s\n", index+1, label(index))
	}
	fmt.Fprint(out, "> ")
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return 0, err
	}
	choice, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || choice < 1 || choice > count {
		return 0, fmt.Errorf("choose a number from 1 to %d", count)
	}
	return choice - 1, nil
}

func contextSuggestedName() string {
	directory, err := canonicalDirectory("")
	if err != nil {
		return "project"
	}
	if key, ok := gitRemoteKeyAt(directory); ok {
		return filepath.Base(strings.TrimPrefix(key, "git:"))
	}
	return filepath.Base(directory)
}

func verifyContextBindingOnline(agentDir string, binding contextBinding) error {
	teamID, err := uuid.Parse(binding.TeamID)
	if err != nil {
		return fmt.Errorf("invalid context team ID: %w", err)
	}
	diaryID, err := uuid.Parse(binding.DiaryID)
	if err != nil {
		return fmt.Errorf("invalid context diary ID: %w", err)
	}
	credentialsPath := filepath.Join(agentDir, "moltnet.json")
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(resolveAPIURLFromCredentials("", false, creds), credentialsPath)
	if err != nil {
		return err
	}
	response, err := client.GetDiary(context.Background(), moltnetapi.GetDiaryParams{ID: diaryID})
	if err != nil {
		return fmt.Errorf("verify context diary: %w", formatTransportError(err))
	}
	diary, ok := response.(*moltnetapi.DiaryCatalog)
	if !ok {
		return formatAPIError(response)
	}
	if diary.TeamId != teamID {
		return fmt.Errorf("context diary %s belongs to team %s, not configured team %s", diaryID, diary.TeamId, teamID)
	}
	return nil
}
