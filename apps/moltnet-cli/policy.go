package main

import (
	"context"
	"fmt"
	"io"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// --- Runtime-policy business logic ---
//
// Runtime policies are named allow-lists of tools and shell-command prefixes.
// A profile binds a set of them and chooses an enforcement mode; the resolved
// union is what a session actually enforces.
//
// Unlike runtime profiles, every runtime-policy endpoint *requires* the team
// header — the generated params carry a plain uuid.UUID rather than an
// optional one — so --team-id is mandatory here rather than falling back to
// the token's current team.

// requirePolicyTeamID parses the mandatory --team-id flag. Policies are
// team-scoped with no server-side fallback, so an empty value is a usage error
// worth naming here instead of letting it surface as a 400.
func requirePolicyTeamID(teamID string) (uuid.UUID, error) {
	if teamID == "" {
		return uuid.Nil, fmt.Errorf("--team-id is required: runtime policies are team-scoped")
	}
	id, err := uuid.Parse(teamID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid --team-id %q: %w", teamID, err)
	}
	return id, nil
}

// runPolicyListCmd lists runtime policies for a team.
func runPolicyListCmd(stdout io.Writer, apiURL, credPath, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListRuntimePolicies(context.Background(), moltnetapi.ListRuntimePoliciesParams{XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("policy list: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.RuntimePolicyList)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(stdout, list)
}

// runPolicyGetCmd fetches a single runtime policy, including its tools and
// shell-command rules, by id or name.
func runPolicyGetCmd(stdout io.Writer, apiURL, credPath, ref, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	policyID, err := resolvePolicyID(client, ref, team)
	if err != nil {
		return err
	}
	res, err := client.GetRuntimePolicy(context.Background(), moltnetapi.GetRuntimePolicyParams{PolicyId: policyID, XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("policy get: %w", formatTransportError(err))
	}
	policy, ok := res.(*moltnetapi.RuntimePolicyWithTools)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(stdout, policy)
}

// runPolicyCreateCmd creates a runtime policy from a JSON definition file.
func runPolicyCreateCmd(stdout io.Writer, apiURL, credPath, fromFile, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	var body moltnetapi.CreateRuntimePolicyBody
	if err := decodePolicyFile(fromFile, &body); err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.CreateRuntimePolicy(context.Background(), moltnetapi.NewOptCreateRuntimePolicyBody(body), moltnetapi.CreateRuntimePolicyParams{XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("policy create: %w", formatTransportError(err))
	}
	policy, ok := res.(*moltnetapi.RuntimePolicyWithTools)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(stdout, policy)
}

// runPolicyUpdateCmd applies an add/remove patch to a runtime policy. The
// update schema is additive/subtractive (addTools, removeTools,
// addShellCommands, removeShellCommands) rather than a whole-document
// replacement, so a patch names only the delta.
func runPolicyUpdateCmd(stdout io.Writer, apiURL, credPath, ref, fromFile, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	var body moltnetapi.UpdateRuntimePolicyBody
	if err := decodePolicyFile(fromFile, &body); err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	policyID, err := resolvePolicyID(client, ref, team)
	if err != nil {
		return err
	}
	res, err := client.UpdateRuntimePolicy(context.Background(), moltnetapi.NewOptUpdateRuntimePolicyBody(body), moltnetapi.UpdateRuntimePolicyParams{PolicyId: policyID, XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("policy update: %w", formatTransportError(err))
	}
	policy, ok := res.(*moltnetapi.RuntimePolicyWithTools)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(stdout, policy)
}

// runPolicyDeleteCmd deletes a runtime policy by id or name.
func runPolicyDeleteCmd(errOut io.Writer, apiURL, credPath, ref, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	policyID, err := resolvePolicyID(client, ref, team)
	if err != nil {
		return err
	}
	res, err := client.DeleteRuntimePolicy(context.Background(), moltnetapi.DeleteRuntimePolicyParams{PolicyId: policyID, XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("policy delete: %w", formatTransportError(err))
	}
	if _, ok := res.(*moltnetapi.DeleteRuntimePolicyNoContent); !ok {
		return formatAPIError(res)
	}
	fmt.Fprintf(errOut, "Deleted runtime policy %s\n", policyID)
	return nil
}

// runProfilePoliciesCmd lists the policy ids currently bound to a profile.
func runProfilePoliciesCmd(stdout io.Writer, apiURL, credPath, ref, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	profileID, err := resolveProfileID(client, ref, teamID)
	if err != nil {
		return err
	}
	res, err := client.GetRuntimeProfilePolicies(context.Background(), moltnetapi.GetRuntimeProfilePoliciesParams{ProfileId: profileID, XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("profile policies: %w", formatTransportError(err))
	}
	bound, ok := res.(*moltnetapi.RuntimeProfilePoliciesResponse)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(stdout, bound)
}

// runProfileSetPoliciesCmd replaces the whole set of policies bound to a
// profile. The endpoint is a PUT, not a merge: whatever is passed becomes the
// complete set, and an empty set unbinds everything. Clearing therefore has to
// be asked for explicitly rather than achieved by omitting --policy, so a
// typo'd flag name cannot silently strip a profile's allow-list.
func runProfileSetPoliciesCmd(errOut io.Writer, apiURL, credPath, ref string, policyRefs []string, clear bool, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	if clear && len(policyRefs) > 0 {
		return fmt.Errorf("--clear cannot be combined with --policy")
	}
	if !clear && len(policyRefs) == 0 {
		return fmt.Errorf("at least one --policy is required (or pass --clear to unbind every policy)")
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	profileID, err := resolveProfileID(client, ref, teamID)
	if err != nil {
		return err
	}
	policyIDs := make([]uuid.UUID, 0, len(policyRefs))
	for _, policyRef := range policyRefs {
		id, err := resolvePolicyID(client, policyRef, team)
		if err != nil {
			return err
		}
		policyIDs = append(policyIDs, id)
	}
	body := moltnetapi.SetProfilePoliciesBody{PolicyIds: policyIDs}
	res, err := client.SetRuntimeProfilePolicies(context.Background(), moltnetapi.NewOptSetProfilePoliciesBody(body), moltnetapi.SetRuntimeProfilePoliciesParams{ProfileId: profileID, XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("profile set-policies: %w", formatTransportError(err))
	}
	if _, ok := res.(*moltnetapi.SetRuntimeProfilePoliciesNoContent); !ok {
		return formatAPIError(res)
	}
	fmt.Fprintf(errOut, "Bound %d runtime polic%s to profile %s\n", len(policyIDs), plural(len(policyIDs), "y", "ies"), profileID)
	return nil
}

// runProfileAllowedToolsCmd resolves what a session on this profile will
// actually enforce: the mode plus the union of every bound policy. This is the
// verification step — bindings and enforcement mode are set separately, so the
// resolved view is the only thing that answers "what will actually happen".
func runProfileAllowedToolsCmd(stdout io.Writer, apiURL, credPath, ref, teamID string) error {
	team, err := requirePolicyTeamID(teamID)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	profileID, err := resolveProfileID(client, ref, teamID)
	if err != nil {
		return err
	}
	res, err := client.GetRuntimeProfileAllowedTools(context.Background(), moltnetapi.GetRuntimeProfileAllowedToolsParams{ProfileId: profileID, XMoltnetTeamID: team})
	if err != nil {
		return fmt.Errorf("profile allowed-tools: %w", formatTransportError(err))
	}
	allowed, ok := res.(*moltnetapi.AllowedToolsResponse)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(stdout, allowed)
}

// resolvePolicyID turns a policy reference into a policy UUID. A reference that
// parses as a UUID is used directly; otherwise it is treated as a name and
// resolved by listing the team's policies, since the get/update/delete
// endpoints are keyed by id.
func resolvePolicyID(client *moltnetapi.Client, ref string, team uuid.UUID) (uuid.UUID, error) {
	if id, err := uuid.Parse(ref); err == nil {
		return id, nil
	}
	res, err := client.ListRuntimePolicies(context.Background(), moltnetapi.ListRuntimePoliciesParams{XMoltnetTeamID: team})
	if err != nil {
		return uuid.Nil, fmt.Errorf("resolve policy %q: %w", ref, formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.RuntimePolicyList)
	if !ok {
		return uuid.Nil, formatAPIError(res)
	}
	for _, item := range list.Items {
		if item.Name == ref {
			return item.ID, nil
		}
	}
	return uuid.Nil, fmt.Errorf("no runtime policy named %q in team %s", ref, team)
}

// decodePolicyFile reads a JSON policy definition from path (or stdin when path
// is "-"). Field-level validation (tool names, argv-prefix grammar) is enforced
// server-side and surfaced as an API error.
func decodePolicyFile(path string, v any) error {
	if path == "" {
		return fmt.Errorf("--from-file is required")
	}
	return decodeJSONFile("policy", path, v)
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
