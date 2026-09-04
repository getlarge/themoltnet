package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// agentKeySecretNotice is written to stderr by create and rotate to remind the
// operator that the returned secret is shown exactly once and cannot be
// recovered afterwards. The secret itself is never included in this notice or
// in any error/diagnostic path — only in the successful JSON result on stdout.
const agentKeySecretNotice = "Store the returned secret now — it is shown exactly once and cannot be retrieved again."

// revocationReasons lists the revocation reasons accepted by --reason, matching
// the API contract's discriminated request body. Used in help text and errors.
var revocationReasons = []string{
	"key_compromise",
	"affiliation_changed",
	"superseded",
	"privilege_withdrawn",
}

func revocationReasonsText() string {
	return strings.Join(revocationReasons, ", ")
}

func agentKeyID(key moltnetapi.AgentKey) (string, bool) {
	if teamKey, ok := key.GetTeamAgentKey(); ok {
		return teamKey.ID, true
	}
	if identityKey, ok := key.GetIdentityAgentKey(); ok {
		return identityKey.ID, true
	}
	return "", false
}

// writeSecretNotice prints the one-time-secret reminder to w (stderr in normal
// use). It falls back to os.Stderr when no writer is provided so the notice is
// never accidentally interleaved into the machine-readable stdout stream.
func writeSecretNotice(w io.Writer) {
	if w == nil {
		w = os.Stderr
	}
	fmt.Fprintln(w, agentKeySecretNotice)
}

// writeIdempotencyRetryHint tells the operator which idempotency key a failed
// create used, so a bare re-run can reuse it instead of minting a duplicate
// credential whose one-time secret would be lost. The idempotency key is not a
// secret. It falls back to os.Stderr so the hint never lands on stdout.
func writeIdempotencyRetryHint(w io.Writer, key string) {
	if w == nil {
		w = os.Stderr
	}
	fmt.Fprintf(w, "The request used idempotency key %s. If it may have reached the server, "+
		"retry with --idempotency-key %s to avoid issuing a duplicate key.\n", key, key)
}

// parseTeamID parses --team-id into a UUID with a consistent error message
// shared by every agent-keys command.
func parseTeamID(v string) (uuid.UUID, error) {
	id, err := uuid.Parse(v)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid --team-id %q: %w", v, err)
	}
	return id, nil
}

type agentKeyBinding struct {
	teamID       moltnetapi.OptUUID
	bindingScope moltnetapi.OptAgentKeyBindingScope
}

// buildAgentKeyBinding enforces the CLI's two explicit, mutually exclusive
// modes before a request is sent. Team mode preserves the pre-existing wire
// contract by omitting bindingScope; identity mode omits the team header and
// sends the explicit identity discriminator.
func buildAgentKeyBinding(teamIDValue string, identityScoped bool) (agentKeyBinding, error) {
	if err := validateAgentKeyBinding(teamIDValue, identityScoped); err != nil {
		return agentKeyBinding{}, err
	}
	if identityScoped {
		return agentKeyBinding{
			bindingScope: moltnetapi.NewOptAgentKeyBindingScope(moltnetapi.AgentKeyBindingScopeIdentity),
		}, nil
	}
	teamID, err := parseTeamID(teamIDValue)
	if err != nil {
		return agentKeyBinding{}, err
	}
	return agentKeyBinding{teamID: moltnetapi.NewOptUUID(teamID)}, nil
}

func validateAgentKeyBinding(teamIDValue string, identityScoped bool) error {
	if identityScoped && teamIDValue != "" {
		return fmt.Errorf("--identity-scoped and --team-id are mutually exclusive")
	}
	if !identityScoped && teamIDValue == "" {
		return fmt.Errorf("one of --team-id or --identity-scoped is required")
	}
	return nil
}

// ----- list -----

type agentsKeysListOpts struct {
	apiURL         string
	credPath       string
	teamID         string
	identityScoped bool
	agentID        string
	agentSet       bool
	status         string
	statusSet      bool
	limit          int
	limitSet       bool
	cursor         string
	cursorSet      bool
	all            bool
	out            io.Writer
}

func runAgentsKeysListCmd(opts agentsKeysListOpts) error {
	client, err := newAuthenticatedClient(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runAgentsKeysListWithClient(context.Background(), client, opts)
}

func runAgentsKeysListWithClient(ctx context.Context, client *moltnetapi.Client, opts agentsKeysListOpts) error {
	params, err := buildListAgentKeysParams(opts)
	if err != nil {
		return err
	}
	fetch := func(cursor moltnetapi.OptString) (*moltnetapi.AgentKeyList, error) {
		page := params
		page.Cursor = cursor
		res, err := client.ListAgentKeys(ctx, page)
		if err != nil {
			return nil, fmt.Errorf("agents keys list: %w", formatTransportError(err))
		}
		list, ok := res.(*moltnetapi.AgentKeyList)
		if !ok {
			return nil, formatAPIError(res)
		}
		return list, nil
	}
	if opts.all {
		list, err := collectAllAgentKeys(params.Cursor, fetch)
		if err != nil {
			return err
		}
		return printJSONTo(opts.out, list)
	}
	list, err := fetch(params.Cursor)
	if err != nil {
		return err
	}
	return printJSONTo(opts.out, list)
}

// collectAllAgentKeys follows opaque continuation cursors until the server stops
// returning one, aggregating every page into a single result. It never returns a
// partial page as if it were complete: any fetch error aborts the whole walk,
// and a server that returns a cursor already followed is rejected so a
// misbehaving upstream cannot spin an infinite loop. The aggregated result
// carries a null nextCursor because the walk is exhaustive.
func collectAllAgentKeys(
	start moltnetapi.OptString,
	fetch func(moltnetapi.OptString) (*moltnetapi.AgentKeyList, error),
) (*moltnetapi.AgentKeyList, error) {
	aggregated := &moltnetapi.AgentKeyList{Items: []moltnetapi.AgentKey{}}
	aggregated.NextCursor.SetToNull()
	seen := map[string]struct{}{}
	cursor := start
	for {
		page, err := fetch(cursor)
		if err != nil {
			return nil, err
		}
		aggregated.Items = append(aggregated.Items, page.Items...)
		next, ok := page.NextCursor.Get()
		if !ok || next == "" {
			return aggregated, nil
		}
		if _, dup := seen[next]; dup {
			return nil, fmt.Errorf(
				"agents keys list: pagination did not advance (server returned a repeated cursor); aborting to avoid an infinite loop",
			)
		}
		seen[next] = struct{}{}
		cursor = moltnetapi.NewOptString(next)
	}
}

func buildListAgentKeysParams(opts agentsKeysListOpts) (moltnetapi.ListAgentKeysParams, error) {
	binding, err := buildAgentKeyBinding(opts.teamID, opts.identityScoped)
	if err != nil {
		return moltnetapi.ListAgentKeysParams{}, err
	}
	params := moltnetapi.ListAgentKeysParams{
		BindingScope:   binding.bindingScope,
		XMoltnetTeamID: binding.teamID,
	}
	if opts.agentSet {
		agentID, err := uuid.Parse(opts.agentID)
		if err != nil {
			return moltnetapi.ListAgentKeysParams{}, fmt.Errorf("invalid --agent-id %q: %w", opts.agentID, err)
		}
		params.AgentId = moltnetapi.NewOptUUID(agentID)
	}
	if opts.statusSet {
		status, err := parseAgentKeyStatus(opts.status)
		if err != nil {
			return moltnetapi.ListAgentKeysParams{}, err
		}
		params.Status = moltnetapi.NewOptListAgentKeysStatus(status)
	}
	if opts.limitSet {
		if opts.limit <= 0 {
			return moltnetapi.ListAgentKeysParams{}, fmt.Errorf("--limit must be >= 1, got %d", opts.limit)
		}
		params.Limit = moltnetapi.NewOptInt(opts.limit)
	}
	if opts.cursorSet {
		params.Cursor = moltnetapi.NewOptString(opts.cursor)
	}
	return params, nil
}

func parseAgentKeyStatus(v string) (moltnetapi.ListAgentKeysStatus, error) {
	switch moltnetapi.ListAgentKeysStatus(v) {
	case moltnetapi.ListAgentKeysStatusActive,
		moltnetapi.ListAgentKeysStatusRevoked,
		moltnetapi.ListAgentKeysStatusExpired:
		return moltnetapi.ListAgentKeysStatus(v), nil
	default:
		return "", fmt.Errorf("invalid --status %q: must be one of active, revoked, expired", v)
	}
}

// ----- create -----

type agentsKeysCreateOpts struct {
	apiURL         string
	credPath       string
	teamID         string
	identityScoped bool
	agentID        string
	name           string
	scopes         []string
	ttlDays        int
	ttlSet         bool
	idempotencyKey string
	idempotencySet bool
	store          agentKeyStoreOpts
	out            io.Writer
	errOut         io.Writer
}

// createAgentKeyOutput is the stable machine-readable result of a create. It
// echoes the idempotency key actually used (the caller's value, or the one the
// CLI generated) so a caller that loses the response can safely replay the same
// request and recover the same key instead of minting a second credential.
type createAgentKeyOutput struct {
	Key            moltnetapi.AgentKey `json:"key"`
	Secret         string              `json:"secret"`
	IdempotencyKey string              `json:"idempotencyKey"`
}

func runAgentsKeysCreateCmd(opts agentsKeysCreateOpts) error {
	// Validate the --store target before authenticating: an unusable
	// destination should be the first thing an operator hears about.
	if _, err := prepareAgentKeyStore(opts.store, opts.credPath); err != nil {
		return err
	}
	client, err := newAuthenticatedClient(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runAgentsKeysCreateWithClient(context.Background(), client, opts)
}

func runAgentsKeysCreateWithClient(ctx context.Context, client *moltnetapi.Client, opts agentsKeysCreateOpts) error {
	req, params, idempotencyKey, err := buildCreateAgentKey(opts)
	if err != nil {
		return err
	}
	// Resolve the store target before the network so a bad destination or
	// credentials file never mints a key whose secret would then be lost.
	store, err := prepareAgentKeyStore(opts.store, opts.credPath)
	if err != nil {
		return err
	}
	if store != nil {
		if err := store.requireAgentID(opts.agentID); err != nil {
			return err
		}
	}
	// When the CLI generated the idempotency key, a failed create must surface
	// it so a bare re-run can reuse it instead of minting a duplicate credential
	// whose one-time secret would be lost. A caller-supplied key already known
	// to the operator needs no hint.
	generated := !opts.idempotencySet || opts.idempotencyKey == ""
	res, err := client.CreateAgentKey(ctx, req, params)
	if err != nil {
		if generated {
			writeIdempotencyRetryHint(opts.errOut, idempotencyKey)
		}
		return fmt.Errorf("agents keys create: %w", formatTransportError(err))
	}
	created, ok := res.(*moltnetapi.AgentKeyWithSecret)
	if !ok {
		if generated {
			writeIdempotencyRetryHint(opts.errOut, idempotencyKey)
		}
		return formatAPIError(res)
	}
	if store != nil {
		return store.persist(opts.out, opts.errOut, storedAgentKeyOutput{
			Key:            created.Key,
			IdempotencyKey: idempotencyKey,
		}, created.Secret)
	}
	writeSecretNotice(opts.errOut)
	return printJSONTo(opts.out, createAgentKeyOutput{
		Key:            created.Key,
		Secret:         created.Secret,
		IdempotencyKey: idempotencyKey,
	})
}

// parseCredentialScopes turns --scopes values into the generated enum, keeping
// input order and rejecting duplicates. Only the scope vocabulary is checked
// here: whether the requesting credential may actually delegate a scope is a
// server decision (it must be a subset of both the canonical agent grant and
// the caller's own scopes), and re-deriving it locally would go stale.
//
// Omitting the flag means "unset" — the server applies the default agent grant.
// `--scopes ""` is a single empty value, not an unset flag, and is rejected:
// a caller who typed it meant to narrow and should hear that it did nothing.
func parseCredentialScopes(values []string) ([]moltnetapi.CredentialScope, error) {
	if len(values) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(values))
	scopes := make([]moltnetapi.CredentialScope, 0, len(values))
	for _, raw := range values {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			return nil, fmt.Errorf("--scopes must not contain an empty value")
		}
		if _, dup := seen[scope]; dup {
			return nil, fmt.Errorf("--scopes lists %q more than once", scope)
		}
		seen[scope] = struct{}{}
		candidate := moltnetapi.CredentialScope(scope)
		if err := candidate.Validate(); err != nil {
			return nil, fmt.Errorf("invalid --scopes value %q: not a known credential scope", scope)
		}
		scopes = append(scopes, candidate)
	}
	return scopes, nil
}

// buildCreateAgentKey assembles the request body and params for a create and
// returns the idempotency key that was resolved. When the caller does not supply
// --idempotency-key the CLI generates a fresh UUID: the API requires the header,
// and generating one keeps single invocations ergonomic while still letting a
// caller pin an explicit value to make a retry idempotent.
func buildCreateAgentKey(opts agentsKeysCreateOpts) (*moltnetapi.CreateAgentKeyReq, moltnetapi.CreateAgentKeyParams, string, error) {
	binding, err := buildAgentKeyBinding(opts.teamID, opts.identityScoped)
	if err != nil {
		return nil, moltnetapi.CreateAgentKeyParams{}, "", err
	}
	agentID, err := uuid.Parse(opts.agentID)
	if err != nil {
		return nil, moltnetapi.CreateAgentKeyParams{}, "", fmt.Errorf("invalid --agent-id %q: %w", opts.agentID, err)
	}
	if opts.name == "" {
		return nil, moltnetapi.CreateAgentKeyParams{}, "", fmt.Errorf("--name is required")
	}
	req := &moltnetapi.CreateAgentKeyReq{
		AgentId:      agentID,
		Name:         opts.name,
		BindingScope: binding.bindingScope,
	}
	scopes, err := parseCredentialScopes(opts.scopes)
	if err != nil {
		return nil, moltnetapi.CreateAgentKeyParams{}, "", err
	}
	req.Scopes = scopes
	if opts.ttlSet {
		if opts.ttlDays <= 0 {
			return nil, moltnetapi.CreateAgentKeyParams{}, "", fmt.Errorf("--ttl-days must be >= 1, got %d", opts.ttlDays)
		}
		req.TtlDays = moltnetapi.NewOptInt(opts.ttlDays)
	}
	idempotencyKey := opts.idempotencyKey
	if !opts.idempotencySet || idempotencyKey == "" {
		idempotencyKey = uuid.NewString()
	}
	params := moltnetapi.CreateAgentKeyParams{
		XMoltnetTeamID: binding.teamID,
		IdempotencyKey: idempotencyKey,
	}
	return req, params, idempotencyKey, nil
}

// ----- rotate -----

type agentsKeysRotateOpts struct {
	apiURL         string
	credPath       string
	teamID         string
	identityScoped bool
	keyID          string
	store          agentKeyStoreOpts
	out            io.Writer
	errOut         io.Writer
}

func runAgentsKeysRotateCmd(opts agentsKeysRotateOpts) error {
	if _, err := prepareAgentKeyStore(opts.store, opts.credPath); err != nil {
		return err
	}
	client, err := newAuthenticatedClient(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runAgentsKeysRotateWithClient(context.Background(), client, opts)
}

func runAgentsKeysRotateWithClient(ctx context.Context, client *moltnetapi.Client, opts agentsKeysRotateOpts) error {
	params, err := buildRotateAgentKeyParams(opts)
	if err != nil {
		return err
	}
	store, err := prepareAgentKeyStore(opts.store, opts.credPath)
	if err != nil {
		return err
	}
	res, err := client.RotateAgentKey(ctx, params)
	if err != nil {
		return fmt.Errorf("agents keys rotate: %w", formatTransportError(err))
	}
	rotated, ok := res.(*moltnetapi.AgentKeyWithSecret)
	if !ok {
		return formatAPIError(res)
	}
	if store != nil {
		output := storedAgentKeyOutput{Key: rotated.Key}
		agentID, _ := agentKeyAgentID(rotated.Key)
		if err := store.requireAgentID(agentID); err != nil {
			// The old secret is already invalid. Preserve the new one in the
			// protected recovery artifact rather than binding it to the wrong
			// identity or printing it.
			output.AgentKeyRef = store.ref
			output.CredentialsPath = store.credentialsPath
			return store.fail(opts.out, output, "verify_identity", rotated.Secret, err)
		}
		return store.persist(opts.out, opts.errOut, output, rotated.Secret)
	}
	writeSecretNotice(opts.errOut)
	return printJSONTo(opts.out, rotated)
}

func buildRotateAgentKeyParams(opts agentsKeysRotateOpts) (moltnetapi.RotateAgentKeyParams, error) {
	binding, err := buildAgentKeyBinding(opts.teamID, opts.identityScoped)
	if err != nil {
		return moltnetapi.RotateAgentKeyParams{}, err
	}
	if opts.keyID == "" {
		return moltnetapi.RotateAgentKeyParams{}, fmt.Errorf("key ID is required")
	}
	return moltnetapi.RotateAgentKeyParams{
		BindingScope:   binding.bindingScope,
		KeyId:          opts.keyID,
		XMoltnetTeamID: binding.teamID,
	}, nil
}

// ----- revoke -----

type agentsKeysRevokeOpts struct {
	apiURL         string
	credPath       string
	teamID         string
	identityScoped bool
	keyID          string
	reason         string
	description    string
	descSet        bool
	out            io.Writer
}

// revokeAgentKeyOutput is the stable machine-readable confirmation printed after
// a successful revoke. The API returns 204 No Content, so the CLI synthesizes a
// small object echoing the key, its new status, and the reason recorded.
type revokeAgentKeyOutput struct {
	KeyID  string `json:"keyId"`
	Status string `json:"status"`
	Reason string `json:"reason"`
}

func runAgentsKeysRevokeCmd(opts agentsKeysRevokeOpts) error {
	client, err := newAuthenticatedClient(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runAgentsKeysRevokeWithClient(context.Background(), client, opts)
}

func runAgentsKeysRevokeWithClient(ctx context.Context, client *moltnetapi.Client, opts agentsKeysRevokeOpts) error {
	body, params, err := buildRevokeAgentKey(opts)
	if err != nil {
		return err
	}
	res, err := client.RevokeAgentKey(ctx, body, params)
	if err != nil {
		return fmt.Errorf("agents keys revoke: %w", formatTransportError(err))
	}
	if _, ok := res.(*moltnetapi.RevokeAgentKeyNoContent); !ok {
		return formatAPIError(res)
	}
	return printJSONTo(opts.out, revokeAgentKeyOutput{
		KeyID:  opts.keyID,
		Status: string(moltnetapi.AgentKeyStatusRevoked),
		Reason: opts.reason,
	})
}

func buildRevokeAgentKey(opts agentsKeysRevokeOpts) (moltnetapi.OptRevokeAgentKeyReq, moltnetapi.RevokeAgentKeyParams, error) {
	binding, err := buildAgentKeyBinding(opts.teamID, opts.identityScoped)
	if err != nil {
		return moltnetapi.OptRevokeAgentKeyReq{}, moltnetapi.RevokeAgentKeyParams{}, err
	}
	if opts.keyID == "" {
		return moltnetapi.OptRevokeAgentKeyReq{}, moltnetapi.RevokeAgentKeyParams{}, fmt.Errorf("key ID is required")
	}
	body, err := buildRevokeReason(opts.reason, opts.description, opts.descSet)
	if err != nil {
		return moltnetapi.OptRevokeAgentKeyReq{}, moltnetapi.RevokeAgentKeyParams{}, err
	}
	return body, moltnetapi.RevokeAgentKeyParams{
		BindingScope:   binding.bindingScope,
		KeyId:          opts.keyID,
		XMoltnetTeamID: binding.teamID,
	}, nil
}

// buildRevokeReason maps the --reason value onto the API's discriminated
// revocation request. A reason is required and must be one of the four contract
// values. A free-text --description is accepted only with privilege_withdrawn,
// the sole variant the contract lets carry one.
func buildRevokeReason(reason, description string, descSet bool) (moltnetapi.OptRevokeAgentKeyReq, error) {
	if reason == "" {
		return moltnetapi.OptRevokeAgentKeyReq{}, fmt.Errorf("--reason is required: must be one of %s", revocationReasonsText())
	}
	hasDescription := descSet && description != ""
	if hasDescription && reason != string(moltnetapi.AgentKeyRevocationReasonPrivilegeWithdrawn) {
		return moltnetapi.OptRevokeAgentKeyReq{}, fmt.Errorf("--description is only valid with --reason privilege_withdrawn")
	}
	switch reason {
	case string(moltnetapi.AgentKeyRevocationReasonKeyCompromise):
		return moltnetapi.NewOptRevokeAgentKeyReq(moltnetapi.NewProvenanceGraphKeyCompromiseNodeRevokeAgentKeyReq(
			moltnetapi.ProvenanceGraphKeyCompromiseNode{
				Reason: moltnetapi.ProvenanceGraphKeyCompromiseNodeReasonKeyCompromise,
			},
		)), nil
	case string(moltnetapi.AgentKeyRevocationReasonAffiliationChanged):
		return moltnetapi.NewOptRevokeAgentKeyReq(moltnetapi.NewProvenanceGraphAffiliationChangedNodeRevokeAgentKeyReq(
			moltnetapi.ProvenanceGraphAffiliationChangedNode{
				Reason: moltnetapi.ProvenanceGraphAffiliationChangedNodeReasonAffiliationChanged,
			},
		)), nil
	case string(moltnetapi.AgentKeyRevocationReasonSuperseded):
		return moltnetapi.NewOptRevokeAgentKeyReq(moltnetapi.NewProvenanceGraphSupersededNodeRevokeAgentKeyReq(
			moltnetapi.ProvenanceGraphSupersededNode{
				Reason: moltnetapi.ProvenanceGraphSupersededNodeReasonSuperseded,
			},
		)), nil
	case string(moltnetapi.AgentKeyRevocationReasonPrivilegeWithdrawn):
		node := moltnetapi.ProvenanceGraphPrivilegeWithdrawnNode{
			Reason: moltnetapi.ProvenanceGraphPrivilegeWithdrawnNodeReasonPrivilegeWithdrawn,
		}
		if hasDescription {
			node.Description = moltnetapi.NewOptString(description)
		}
		return moltnetapi.NewOptRevokeAgentKeyReq(moltnetapi.NewProvenanceGraphPrivilegeWithdrawnNodeRevokeAgentKeyReq(node)), nil
	default:
		return moltnetapi.OptRevokeAgentKeyReq{}, fmt.Errorf("invalid --reason %q: must be one of %s", reason, revocationReasonsText())
	}
}
