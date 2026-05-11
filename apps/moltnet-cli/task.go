package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

type taskTailOpts struct {
	apiURL       string
	credPath     string
	taskID       string
	attempt      int  // 0 = latest
	since        int  // exclusive cursor
	sinceChanged bool // distinguishes --since 0 (replay all) from default
	kindFilter   string
	intervalSec  int
	showDeltas   bool
	format       string // "human" | "json"
	out          io.Writer
}

type taskListOpts struct {
	apiURL   string
	credPath string

	teamID string

	taskTypes          []string
	taskTypesSet       bool
	taskTypeAliases    []string
	taskTypeAliasesSet bool

	status              string
	statusSet           bool
	diaryID             string
	diaryIDSet          bool
	correlationID       string
	correlationIDSet    bool
	imposedByAgentID    string
	imposedByAgentIDSet bool
	imposedByHumanID    string
	imposedByHumanIDSet bool
	claimedByAgentID    string
	claimedByAgentIDSet bool
	provider            string
	providerSet         bool
	model               string
	modelSet            bool
	hasAttempts         bool
	hasAttemptsSet      bool
	queuedAfter         string
	queuedAfterSet      bool
	queuedBefore        string
	queuedBeforeSet     bool
	completedAfter      string
	completedAfterSet   bool
	completedBefore     string
	completedBeforeSet  bool
	limit               int
	limitSet            bool
	cursor              string
	cursorSet           bool
}

func runTaskListCmd(opts taskListOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskListWithClient(context.Background(), client, opts)
}

func runTaskListWithClient(ctx context.Context, client *moltnetapi.Client, opts taskListOpts) error {
	params, err := buildListTasksParams(opts)
	if err != nil {
		return err
	}

	res, err := client.ListTasks(ctx, params)
	if err != nil {
		return fmt.Errorf("task list: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.TaskListResponse)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(list)
}

func buildListTasksParams(opts taskListOpts) (moltnetapi.ListTasksParams, error) {
	teamID, err := uuid.Parse(opts.teamID)
	if err != nil {
		return moltnetapi.ListTasksParams{}, fmt.Errorf("invalid --team-id %q: %w", opts.teamID, err)
	}

	params := moltnetapi.ListTasksParams{TeamId: teamID}

	if opts.taskTypesSet {
		params.TaskTypes = append(params.TaskTypes, cleanCSVValues(opts.taskTypes)...)
	}
	if opts.taskTypeAliasesSet {
		params.TaskTypes = append(params.TaskTypes, cleanCSVValues(opts.taskTypeAliases)...)
	}
	if (opts.taskTypesSet || opts.taskTypeAliasesSet) && len(params.TaskTypes) == 0 {
		return moltnetapi.ListTasksParams{}, fmt.Errorf("--task-types / --task-type: at least one non-empty value is required")
	}
	if opts.statusSet {
		var status moltnetapi.TaskStatus
		if err := status.UnmarshalText([]byte(opts.status)); err != nil {
			return moltnetapi.ListTasksParams{}, fmt.Errorf("invalid --status %q: %w", opts.status, err)
		}
		params.Status = moltnetapi.NewOptTaskStatus(status)
	}

	if opts.diaryIDSet {
		if params.DiaryId, err = parseOptUUIDFlag("diary-id", opts.diaryID); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.correlationIDSet {
		if params.CorrelationId, err = parseOptUUIDFlag("correlation-id", opts.correlationID); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.imposedByAgentIDSet {
		if params.ImposedByAgentId, err = parseOptUUIDFlag("imposed-by-agent-id", opts.imposedByAgentID); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.imposedByHumanIDSet {
		if params.ImposedByHumanId, err = parseOptUUIDFlag("imposed-by-human-id", opts.imposedByHumanID); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.claimedByAgentIDSet {
		if params.ClaimedByAgentId, err = parseOptUUIDFlag("claimed-by-agent-id", opts.claimedByAgentID); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}

	if opts.providerSet != opts.modelSet {
		return moltnetapi.ListTasksParams{}, fmt.Errorf("--provider and --model must be set together")
	}
	if opts.providerSet {
		provider := strings.TrimSpace(opts.provider)
		model := strings.TrimSpace(opts.model)
		if provider == "" || model == "" {
			return moltnetapi.ListTasksParams{}, fmt.Errorf("--provider and --model must both be non-empty")
		}
		params.Provider = moltnetapi.NewOptString(provider)
		params.Model = moltnetapi.NewOptString(model)
	}
	if opts.hasAttemptsSet {
		params.HasAttempts = moltnetapi.NewOptBool(opts.hasAttempts)
	}

	if opts.queuedAfterSet {
		if params.QueuedAfter, err = parseOptRFC3339Flag("queued-after", opts.queuedAfter); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.queuedBeforeSet {
		if params.QueuedBefore, err = parseOptRFC3339Flag("queued-before", opts.queuedBefore); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.completedAfterSet {
		if params.CompletedAfter, err = parseOptRFC3339Flag("completed-after", opts.completedAfter); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.completedBeforeSet {
		if params.CompletedBefore, err = parseOptRFC3339Flag("completed-before", opts.completedBefore); err != nil {
			return moltnetapi.ListTasksParams{}, err
		}
	}
	if opts.limitSet {
		if opts.limit <= 0 {
			return moltnetapi.ListTasksParams{}, fmt.Errorf("--limit must be >= 1, got %d", opts.limit)
		}
		params.Limit = moltnetapi.NewOptInt(opts.limit)
	}
	if opts.cursorSet {
		params.Cursor = moltnetapi.NewOptString(opts.cursor)
	}

	return params, nil
}

func cleanCSVValues(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, splitAndTrim(value, ",")...)
	}
	return out
}

func parseOptUUIDFlag(name, value string) (moltnetapi.OptUUID, error) {
	id, err := uuid.Parse(value)
	if err != nil {
		return moltnetapi.OptUUID{}, fmt.Errorf("invalid --%s %q: %w", name, value, err)
	}
	return moltnetapi.NewOptUUID(id), nil
}

func parseOptRFC3339Flag(name, value string) (moltnetapi.OptDateTime, error) {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return moltnetapi.OptDateTime{}, fmt.Errorf("invalid --%s %q: %w", name, value, err)
	}
	return moltnetapi.NewOptDateTime(t), nil
}

func runTaskGetCmd(apiURL, credPath, taskID string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	return runTaskGetWithClient(context.Background(), client, taskID)
}

func runTaskGetWithClient(ctx context.Context, client *moltnetapi.Client, taskID string) error {
	taskUUID, err := uuid.Parse(taskID)
	if err != nil {
		return fmt.Errorf("invalid task ID %q: %w", taskID, err)
	}

	res, err := client.GetTask(ctx, moltnetapi.GetTaskParams{ID: taskUUID})
	if err != nil {
		return fmt.Errorf("task get: %w", formatTransportError(err))
	}
	task, ok := res.(*moltnetapi.Task)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(task)
}

func runTaskTailCmd(opts taskTailOpts) error {
	if opts.format != "human" && opts.format != "json" {
		return fmt.Errorf("--format: unsupported value %q (one of: human, json)", opts.format)
	}
	if opts.intervalSec < 1 {
		return fmt.Errorf("--interval must be >= 1, got %d", opts.intervalSec)
	}
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskTailWithClient(context.Background(), client, opts)
}

// runTaskTailWithClient is the testable inner loop. The cobra wrapper
// loads credentials and constructs the client; tests inject their own
// stub-server-backed client directly to exercise the polling behaviour
// without touching disk.
func runTaskTailWithClient(ctx context.Context, client *moltnetapi.Client, opts taskTailOpts) error {
	taskUUID, err := uuid.Parse(opts.taskID)
	if err != nil {
		return fmt.Errorf("invalid task ID %q: %w", opts.taskID, err)
	}

	kindAllow, err := parseKindFilter(opts.kindFilter, opts.showDeltas)
	if err != nil {
		return err
	}

	// Resolve the attempt number. When unset, fetch the task's attempt
	// list and pick the latest. We do this once at the start and reuse;
	// re-claims would create a new attempt mid-tail but the operator
	// asked to follow *this* attempt, not the chain.
	attemptN, err := resolveAttempt(ctx, client, taskUUID, opts.attempt)
	if err != nil {
		return err
	}

	// Initial cursor.
	//
	// `--since N` is *inclusive*: print every message with seq >= N. The
	// server's afterSeq query param is exclusive, so we pass N-1. Special
	// case: --since 0 means "from the very first message" → omit afterSeq
	// entirely (passing -1 would also work but the API rejects negatives).
	//
	// Default (--since not changed): skip backlog and only show messages
	// that arrive while we're tailing. We compute the current latest seq
	// once and use it as the exclusive cursor.
	var afterSeq moltnetapi.OptInt
	if opts.sinceChanged {
		if opts.since > 0 {
			afterSeq = moltnetapi.OptInt{Value: opts.since - 1, Set: true}
		}
		// since == 0 → afterSeq stays unset → server returns all msgs
	} else {
		latest, err := latestSeq(ctx, client, taskUUID, attemptN)
		if err != nil {
			return err
		}
		if latest >= 0 {
			afterSeq = moltnetapi.OptInt{Value: latest, Set: true}
		}
	}

	interval := time.Duration(opts.intervalSec) * time.Second
	for {
		messages, err := fetchMessages(ctx, client, taskUUID, attemptN, afterSeq)
		if err != nil {
			return err
		}
		// Advance the cursor for EVERY received message, even ones the
		// kind filter suppresses — otherwise a fully-filtered page (e.g.
		// a burst of `text_delta` while `--show-deltas` is off) leaves
		// `afterSeq` unchanged and the next poll re-fetches the same
		// page, spinning until the task terminates.
		for _, m := range messages {
			seq := int(m.Seq)
			if !afterSeq.Set || seq > afterSeq.Value {
				afterSeq = moltnetapi.OptInt{Value: seq, Set: true}
			}
			if !kindAllow[string(m.Kind)] {
				continue
			}
			if err := printMessage(opts.out, opts.format, m); err != nil {
				return err
			}
		}

		// Check terminal status. Done after printing so the final
		// messages (turn_end, error) land before we exit.
		terminal, err := taskIsTerminal(ctx, client, taskUUID)
		if err != nil {
			return err
		}
		if terminal {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
		}
	}
}

// resolveAttempt picks the requested attempt or the latest one when 0.
// Returns the attempt number as an int (the wire schema uses float64 for
// historical reasons; we coerce on the boundary).
func resolveAttempt(ctx context.Context, client *moltnetapi.Client, taskID uuid.UUID, requested int) (int, error) {
	if requested > 0 {
		return requested, nil
	}
	res, err := client.ListTaskAttempts(ctx, moltnetapi.ListTaskAttemptsParams{ID: taskID})
	if err != nil {
		return 0, fmt.Errorf("list attempts: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.ListTaskAttemptsOKApplicationJSON)
	if !ok {
		return 0, formatAPIError(res)
	}
	if len(*list) == 0 {
		return 0, fmt.Errorf("task %s has no attempts yet — wait for claim and retry", taskID)
	}
	// Server orders attempts; pick the highest attemptN to be safe.
	max := 0
	for _, a := range *list {
		if int(a.AttemptN) > max {
			max = int(a.AttemptN)
		}
	}
	return max, nil
}

// latestSeq returns the highest seq currently visible on the attempt, or
// -1 when there are no messages yet. Used to skip the backlog when tail
// is invoked without --since.
//
// `GET /tasks/:id/attempts/:n/messages` is server-paged in ascending seq
// order. A single fetch returns at most one page; for an attempt with N
// pages of backlog the naive "read first page, take its max" approach
// would skip everything past page 1 — and then on first poll we'd
// stream the rest of the backlog as if it were live. We page through
// using afterSeq until the server returns an empty page.
func latestSeq(ctx context.Context, client *moltnetapi.Client, taskID uuid.UUID, attemptN int) (int, error) {
	max := -1
	var afterSeq moltnetapi.OptInt
	// Bound the loop so a buggy server can't keep us reading forever.
	// The default page size is well under 1000 and an attempt with
	// >100k messages would be a separate problem; this caps us at
	// ~100 pages to be very safe.
	const maxPages = 200
	for page := 0; page < maxPages; page++ {
		messages, err := fetchMessages(ctx, client, taskID, attemptN, afterSeq)
		if err != nil {
			return 0, err
		}
		if len(messages) == 0 {
			break
		}
		for _, m := range messages {
			if int(m.Seq) > max {
				max = int(m.Seq)
			}
		}
		afterSeq = moltnetapi.OptInt{Value: max, Set: true}
	}
	return max, nil
}

func fetchMessages(ctx context.Context, client *moltnetapi.Client, taskID uuid.UUID, attemptN int, afterSeq moltnetapi.OptInt) ([]moltnetapi.TaskMessage, error) {
	params := moltnetapi.ListTaskMessagesParams{
		ID:       taskID,
		N:        attemptN,
		AfterSeq: afterSeq,
	}
	res, err := client.ListTaskMessages(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", formatTransportError(err))
	}
	page, ok := res.(*moltnetapi.ListTaskMessagesOKApplicationJSON)
	if !ok {
		return nil, formatAPIError(res)
	}
	out := []moltnetapi.TaskMessage(*page)
	// Defensive sort — the API contract is ascending seq, but a future
	// pagination layer could shuffle order; tail must always print in
	// seq order so the cursor advance is monotonic.
	sort.Slice(out, func(i, j int) bool {
		return out[i].Seq < out[j].Seq
	})
	return out, nil
}

func taskIsTerminal(ctx context.Context, client *moltnetapi.Client, taskID uuid.UUID) (bool, error) {
	res, err := client.GetTask(ctx, moltnetapi.GetTaskParams{ID: taskID})
	if err != nil {
		return false, fmt.Errorf("get task: %w", formatTransportError(err))
	}
	task, ok := res.(*moltnetapi.Task)
	if !ok {
		return false, formatAPIError(res)
	}
	switch task.Status {
	case moltnetapi.TaskStatusCompleted,
		moltnetapi.TaskStatusFailed,
		moltnetapi.TaskStatusCancelled,
		moltnetapi.TaskStatusExpired:
		return true, nil
	default:
		return false, nil
	}
}

// parseKindFilter validates `--kind` and returns a set of accepted kinds.
// When the flag is empty, every kind passes (text_delta gated separately
// by --show-deltas).
func parseKindFilter(kindStr string, showDeltas bool) (map[string]bool, error) {
	allKinds := []string{"text_delta", "tool_call_start", "tool_call_end", "turn_end", "error", "info"}
	allow := map[string]bool{}
	if kindStr == "" {
		for _, k := range allKinds {
			allow[k] = true
		}
	} else {
		valid := map[string]bool{}
		for _, k := range allKinds {
			valid[k] = true
		}
		for _, k := range splitAndTrim(kindStr, ",") {
			if !valid[k] {
				return nil, fmt.Errorf("--kind: unknown kind %q (one of: %s)", k, strings.Join(allKinds, ","))
			}
			allow[k] = true
		}
	}
	if !showDeltas {
		// text_delta is the noisy one; suppress unless explicitly asked.
		// If the user passed --kind text_delta directly we honor it.
		if kindStr == "" || !explicitlyMentions(kindStr, "text_delta") {
			delete(allow, "text_delta")
		}
	}
	return allow, nil
}

func explicitlyMentions(csv, want string) bool {
	for _, k := range splitAndTrim(csv, ",") {
		if k == want {
			return true
		}
	}
	return false
}

// printMessage writes a single message line in either human or json format.
// Human format mirrors the daemon's pino conventions for readability:
//
//	[seq=N HH:MM:SS] kind        key=value key=value ...
func printMessage(out io.Writer, format string, m moltnetapi.TaskMessage) error {
	if format == "json" {
		// Round-trip through the wire types so the output matches the
		// API exactly — operators can `| jq` on it.
		b, err := json.Marshal(m)
		if err != nil {
			return fmt.Errorf("marshal message seq=%d: %w", int(m.Seq), err)
		}
		_, err = fmt.Fprintln(out, string(b))
		return err
	}
	ts := m.Timestamp.UTC().Format("15:04:05")
	payload := payloadOneLine(m.Payload)
	_, err := fmt.Fprintf(out, "[seq=%d %s] %-16s %s\n", int(m.Seq), ts, string(m.Kind), payload)
	return err
}

// payloadOneLine collapses a TaskMessagePayload (raw JSON map) into a
// single readable `key=value key=value` string for human format. Long
// strings are truncated to keep terminals readable.
func payloadOneLine(p moltnetapi.TaskMessagePayload) string {
	if len(p) == 0 {
		return ""
	}
	keys := make([]string, 0, len(p))
	for k := range p {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		raw := p[k]
		var v interface{}
		if err := json.Unmarshal(raw, &v); err != nil {
			parts = append(parts, fmt.Sprintf("%s=<unmarshal-err>", k))
			continue
		}
		parts = append(parts, fmt.Sprintf("%s=%s", k, formatScalar(v)))
	}
	return strings.Join(parts, " ")
}

func formatScalar(v interface{}) string {
	switch x := v.(type) {
	case string:
		// Truncate long prose so a tool's stack trace doesn't wrap the
		// whole terminal. Keep the leading content; the full payload is
		// in --format json or via tasks.messages.list.
		const maxChars = 120
		if len(x) > maxChars {
			return fmt.Sprintf("%q…(+%dchars)", x[:maxChars], len(x)-maxChars)
		}
		return fmt.Sprintf("%q", x)
	case float64:
		if x == float64(int64(x)) {
			return fmt.Sprintf("%d", int64(x))
		}
		return fmt.Sprintf("%g", x)
	case bool:
		return fmt.Sprintf("%t", x)
	case nil:
		return "null"
	default:
		// map / array — fall through to compact JSON; rare in
		// per-message payloads (info events occasionally embed
		// nested context).
		b, err := json.Marshal(x)
		if err != nil {
			return "<?>"
		}
		return string(b)
	}
}
