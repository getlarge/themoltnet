package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// runTeamsListCmd lists all teams for the authenticated agent.
func runTeamsListCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListTeams(context.Background())
	if err != nil {
		return fmt.Errorf("teams list: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.ListTeamsOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(list)
}

// runTeamsGetCmd fetches a team by ID (includes members).
func runTeamsGetCmd(apiURL, credPath, teamID string) error {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid team ID %q: %w", teamID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetTeam(context.Background(), moltnetapi.GetTeamParams{ID: teamUUID})
	if err != nil {
		return fmt.Errorf("teams get: %w", formatTransportError(err))
	}
	team, ok := res.(*moltnetapi.GetTeamOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(team)
}

// runTeamsMembersCmd lists members of a team.
func runTeamsMembersCmd(apiURL, credPath, teamID string) error {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid team ID %q: %w", teamID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListTeamMembers(context.Background(), moltnetapi.ListTeamMembersParams{ID: teamUUID})
	if err != nil {
		return fmt.Errorf("teams members: %w", formatTransportError(err))
	}
	members, ok := res.(*moltnetapi.ListTeamMembersOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(members)
}

// runTeamsCreateCmd creates a new team.
func runTeamsCreateCmd(apiURL, credPath, name string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.CreateTeamReq{
		Name: name,
	}
	res, err := client.CreateTeam(context.Background(), req)
	if err != nil {
		return fmt.Errorf("teams create: %w", formatTransportError(err))
	}
	team, ok := res.(*moltnetapi.CreateTeamCreated)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(team)
}

// runTeamsJoinCmd joins a team using an invite code.
func runTeamsJoinCmd(apiURL, credPath, code string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.JoinTeamReq{
		Code: code,
	}
	res, err := client.JoinTeam(context.Background(), req)
	if err != nil {
		return fmt.Errorf("teams join: %w", formatTransportError(err))
	}
	result, ok := res.(*moltnetapi.JoinTeamOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(result)
}

// runTeamsInviteCreateCmd creates an invite code for a team.
func runTeamsInviteCreateCmd(apiURL, credPath, teamID, role string, expiresInHours, maxUses int) error {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid team ID %q: %w", teamID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	req := moltnetapi.OptCreateTeamInviteReq{Set: true}
	if role != "" {
		req.Value.Role = moltnetapi.OptCreateTeamInviteReqRole{
			Value: moltnetapi.CreateTeamInviteReqRole(role),
			Set:   true,
		}
	}
	if expiresInHours > 0 {
		req.Value.ExpiresInHours = moltnetapi.OptInt{Value: expiresInHours, Set: true}
	}
	if maxUses > 0 {
		req.Value.MaxUses = moltnetapi.OptInt{Value: maxUses, Set: true}
	}

	res, err := client.CreateTeamInvite(context.Background(), req, moltnetapi.CreateTeamInviteParams{ID: teamUUID})
	if err != nil {
		return fmt.Errorf("teams invite create: %w", formatTransportError(err))
	}
	invite, ok := res.(*moltnetapi.CreateTeamInviteCreated)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(invite)
}

// runTeamsDeleteCmd deletes a team (owner only).
func runTeamsDeleteCmd(apiURL, credPath, teamID string) error {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid team ID %q: %w", teamID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.DeleteTeam(context.Background(), moltnetapi.DeleteTeamParams{ID: teamUUID})
	if err != nil {
		return fmt.Errorf("teams delete: %w", formatTransportError(err))
	}
	ok, okRes := res.(*moltnetapi.DeleteTeamOK)
	if !okRes {
		return formatAPIError(res)
	}
	return printJSON(ok)
}

// runTeamsMemberRemoveCmd removes a member from a team.
func runTeamsMemberRemoveCmd(apiURL, credPath, teamID, subjectID string) error {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid team ID %q: %w", teamID, err)
	}
	subjectUUID, err := uuid.Parse(subjectID)
	if err != nil {
		return fmt.Errorf("invalid subject ID %q: %w", subjectID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.RemoveTeamMember(context.Background(), moltnetapi.RemoveTeamMemberParams{
		ID:        teamUUID,
		SubjectId: subjectUUID,
	})
	if err != nil {
		return fmt.Errorf("teams members remove: %w", formatTransportError(err))
	}
	ok, okRes := res.(*moltnetapi.RemoveTeamMemberOK)
	if !okRes {
		return formatAPIError(res)
	}
	return printJSON(ok)
}

// runTeamsInviteDeleteCmd deletes a team invite code.
func runTeamsInviteDeleteCmd(apiURL, credPath, teamID, inviteID string) error {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid team ID %q: %w", teamID, err)
	}
	inviteUUID, err := uuid.Parse(inviteID)
	if err != nil {
		return fmt.Errorf("invalid invite ID %q: %w", inviteID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.DeleteTeamInvite(context.Background(), moltnetapi.DeleteTeamInviteParams{
		ID:       teamUUID,
		InviteId: inviteUUID,
	})
	if err != nil {
		return fmt.Errorf("teams invite delete: %w", formatTransportError(err))
	}
	ok, okRes := res.(*moltnetapi.DeleteTeamInviteOK)
	if !okRes {
		return formatAPIError(res)
	}
	return printJSON(ok)
}

// runTeamsInviteListCmd lists invite codes for a team.
func runTeamsInviteListCmd(apiURL, credPath, teamID string) error {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid team ID %q: %w", teamID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListTeamInvites(context.Background(), moltnetapi.ListTeamInvitesParams{ID: teamUUID})
	if err != nil {
		return fmt.Errorf("teams invite list: %w", formatTransportError(err))
	}
	invites, ok := res.(*moltnetapi.ListTeamInvitesOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(invites)
}
