package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

var projectCommandInteractive = func(cmd *cobra.Command) bool {
	file, ok := cmd.InOrStdin().(*os.File)
	return ok && term.IsTerminal(int(file.Fd()))
}

func guidedTeamDiary(cmd *cobra.Command, agentDir string) (string, string, error) {
	return guidedTeamDiaryWithReader(cmd, agentDir, bufio.NewReader(cmd.InOrStdin()))
}

func guidedTeamDiaryWithReader(cmd *cobra.Command, agentDir string, reader *bufio.Reader) (string, string, error) {
	if identityDefault, ok := identityDefaultBinding(agentDir); ok {
		choice, err := promptChoice(cmd.OutOrStdout(), reader, "This identity's default team and diary are set", 2, func(index int) string {
			if index == 0 {
				return fmt.Sprintf("Use them for this location (team %s, diary %s)", identityDefault.TeamID, identityDefault.DiaryID)
			}
			return "Choose a team and diary online"
		})
		if err != nil {
			return "", "", err
		}
		if choice == 0 {
			return identityDefault.TeamID, identityDefault.DiaryID, nil
		}
	}
	credentialsPath := filepath.Join(agentDir, "moltnet.json")
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		return "", "", err
	}
	// A key-only identity can choose from local slots before it has a context.
	// Never use one team's key to discover another team's diaries.
	selectedTeam := ""
	if creds != nil && !hasOAuth2Configuration(creds) && len(creds.AgentKeyRefs) > 0 && strings.TrimSpace(os.Getenv(agentKeyEnv)) == "" && strings.TrimSpace(os.Getenv(agentKeyRefEnv)) == "" {
		ids := make([]string, 0, len(creds.AgentKeyRefs))
		for id := range creds.AgentKeyRefs {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		choice, err := promptChoice(cmd.OutOrStdout(), reader, "Choose a configured team", len(ids), func(i int) string { return ids[i] })
		if err != nil {
			return "", "", err
		}
		selectedTeam = ids[choice]
	}
	client, err := newAuthenticatedClient(resolveAPIURLFromCredentials("", false, creds), credentialsPath, selectedTeam)
	if err != nil {
		return "", "", err
	}
	if selectedTeam == "" {
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
		selectedTeam = teams.Items[teamIndex].ID.String()
	}
	teamID, err := uuid.Parse(selectedTeam)
	if err != nil {
		return "", "", fmt.Errorf("invalid configured team ID: %w", err)
	}

	client, err = newAuthenticatedClient(resolveAPIURLFromCredentials("", false, creds), credentialsPath, selectedTeam)
	if err != nil {
		return "", "", err
	}
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
			return "", "", fmt.Errorf("project setup cancelled")
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
	client, err := newAuthenticatedClient(resolveAPIURLFromCredentials("", false, creds), credentialsPath, binding.TeamID)
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
