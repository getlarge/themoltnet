package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// --- Runtime-profile business logic ---

// runProfileListCmd lists runtime profiles for a team. The team header is
// optional; when omitted the server falls back to the token's current team.
func runProfileListCmd(apiURL, credPath, teamID string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	params := moltnetapi.ListRuntimeProfilesParams{}
	if teamID != "" {
		team, err := parseOptUUIDFlag("team-id", teamID)
		if err != nil {
			return err
		}
		params.XMoltnetTeamID = team
	}
	res, err := client.ListRuntimeProfiles(context.Background(), params)
	if err != nil {
		return fmt.Errorf("profile list: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.RuntimeProfileListResponse)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(list)
}

// runProfileGetCmd fetches a single runtime profile by id or name.
func runProfileGetCmd(apiURL, credPath, ref, teamID string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	profileID, err := resolveProfileID(client, ref, teamID)
	if err != nil {
		return err
	}
	res, err := client.GetRuntimeProfile(context.Background(), moltnetapi.GetRuntimeProfileParams{ProfileId: profileID})
	if err != nil {
		return fmt.Errorf("profile get: %w", formatTransportError(err))
	}
	profile, ok := res.(*moltnetapi.RuntimeProfile)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(profile)
}

// runProfileCreateCmd creates a runtime profile from a JSON definition file.
func runProfileCreateCmd(apiURL, credPath, fromFile, teamID string) error {
	var body moltnetapi.CreateRuntimeProfileBody
	if err := decodeProfileFile(fromFile, &body); err != nil {
		return err
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	params := moltnetapi.CreateRuntimeProfileParams{}
	if teamID != "" {
		team, err := parseOptUUIDFlag("team-id", teamID)
		if err != nil {
			return err
		}
		params.XMoltnetTeamID = team
	}
	res, err := client.CreateRuntimeProfile(context.Background(), moltnetapi.NewOptCreateRuntimeProfileBody(body), params)
	if err != nil {
		return fmt.Errorf("profile create: %w", formatTransportError(err))
	}
	profile, ok := res.(*moltnetapi.RuntimeProfile)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(profile)
}

// runProfileUpdateCmd applies a partial JSON patch to a runtime profile.
func runProfileUpdateCmd(apiURL, credPath, ref, fromFile, teamID string) error {
	var body moltnetapi.UpdateRuntimeProfileBody
	if err := decodeProfileFile(fromFile, &body); err != nil {
		return err
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	profileID, err := resolveProfileID(client, ref, teamID)
	if err != nil {
		return err
	}
	res, err := client.UpdateRuntimeProfile(context.Background(), moltnetapi.NewOptUpdateRuntimeProfileBody(body), moltnetapi.UpdateRuntimeProfileParams{ProfileId: profileID})
	if err != nil {
		return fmt.Errorf("profile update: %w", formatTransportError(err))
	}
	profile, ok := res.(*moltnetapi.RuntimeProfile)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(profile)
}

// runProfileDeleteCmd deletes a runtime profile by id or name.
func runProfileDeleteCmd(apiURL, credPath, ref, teamID string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	profileID, err := resolveProfileID(client, ref, teamID)
	if err != nil {
		return err
	}
	res, err := client.DeleteRuntimeProfile(context.Background(), moltnetapi.DeleteRuntimeProfileParams{ProfileId: profileID})
	if err != nil {
		return fmt.Errorf("profile delete: %w", formatTransportError(err))
	}
	if _, ok := res.(*moltnetapi.DeleteRuntimeProfileNoContent); !ok {
		return formatAPIError(res)
	}
	fmt.Fprintf(os.Stderr, "Deleted runtime profile %s\n", profileID)
	return nil
}

// resolveProfileID turns a profile reference into a profile UUID. A reference
// that parses as a UUID is used directly. Otherwise it is treated as a profile
// name and resolved by listing the team's runtime profiles and matching by name
// (the get/update/delete endpoints are keyed by id, not name). --team-id is
// optional here just as it is for list: when omitted, the list request carries
// no team header and the server scopes it to the token's current team.
func resolveProfileID(client *moltnetapi.Client, ref, teamID string) (uuid.UUID, error) {
	if id, err := uuid.Parse(ref); err == nil {
		return id, nil
	}
	params := moltnetapi.ListRuntimeProfilesParams{}
	if teamID != "" {
		team, err := parseOptUUIDFlag("team-id", teamID)
		if err != nil {
			return uuid.Nil, err
		}
		params.XMoltnetTeamID = team
	}
	res, err := client.ListRuntimeProfiles(context.Background(), params)
	if err != nil {
		return uuid.Nil, fmt.Errorf("resolve profile %q: %w", ref, formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.RuntimeProfileListResponse)
	if !ok {
		return uuid.Nil, formatAPIError(res)
	}
	for _, item := range list.Items {
		if item.Name == ref {
			return item.ID, nil
		}
	}
	scope := "the token's current team"
	if teamID != "" {
		scope = "team " + teamID
	}
	return uuid.Nil, fmt.Errorf("no runtime profile named %q in %s", ref, scope)
}

// decodeProfileFile reads a JSON profile definition from path (or stdin when
// path is "-") and unmarshals it into an ogen request-body struct via its
// generated UnmarshalJSON. Field-level schema validation (model-option ranges,
// workspace policy) is enforced server-side and surfaced as an API error.
func decodeProfileFile(path string, v any) error {
	if path == "" {
		return fmt.Errorf("--from-file is required")
	}
	var (
		data []byte
		err  error
	)
	if path == "-" {
		data, err = io.ReadAll(os.Stdin)
	} else {
		data, err = os.ReadFile(path)
	}
	if err != nil {
		return fmt.Errorf("read profile file %q: %w", path, err)
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("parse profile file %q: %w", path, err)
	}
	return nil
}
