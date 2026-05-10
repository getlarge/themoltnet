package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/go-faster/jx"
)

// ── parseKindFilter ───────────────────────────────────────────────────────────

func TestParseKindFilter_DefaultDropsTextDelta(t *testing.T) {
	allow, err := parseKindFilter("", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allow["text_delta"] {
		t.Errorf("expected text_delta dropped by default")
	}
	for _, k := range []string{"info", "tool_call_start", "tool_call_end", "turn_end", "error"} {
		if !allow[k] {
			t.Errorf("expected %q allowed by default", k)
		}
	}
}

func TestParseKindFilter_ShowDeltasIncludesTextDelta(t *testing.T) {
	allow, err := parseKindFilter("", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allow["text_delta"] {
		t.Errorf("expected text_delta allowed when --show-deltas")
	}
}

func TestParseKindFilter_ExplicitKindNarrowsButTextDeltaStillRequiresShowDeltas(t *testing.T) {
	allow, err := parseKindFilter("turn_end,error", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allow["turn_end"] || !allow["error"] {
		t.Errorf("explicit kinds should pass: %#v", allow)
	}
	if allow["info"] {
		t.Errorf("expected info dropped when not in --kind list")
	}
}

func TestParseKindFilter_ExplicitTextDeltaWithoutShowDeltasHonored(t *testing.T) {
	// --kind text_delta is explicit intent; honor it even without
	// --show-deltas (the operator typed it).
	allow, err := parseKindFilter("text_delta", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allow["text_delta"] {
		t.Errorf("expected explicit --kind text_delta to be allowed")
	}
}

func TestParseKindFilter_UnknownKindRejected(t *testing.T) {
	_, err := parseKindFilter("does_not_exist", false)
	if err == nil {
		t.Fatal("expected error for unknown kind")
	}
	if !strings.Contains(err.Error(), "does_not_exist") {
		t.Errorf("error should name the bad kind: %v", err)
	}
}

// ── formatScalar / payloadOneLine ─────────────────────────────────────────────

func TestFormatScalar_Strings(t *testing.T) {
	if got := formatScalar("hello"); got != `"hello"` {
		t.Errorf("got %q, want %q", got, `"hello"`)
	}
}

func TestFormatScalar_LongStringTruncated(t *testing.T) {
	long := strings.Repeat("x", 200)
	got := formatScalar(long)
	if !strings.Contains(got, "…(+80chars)") {
		t.Errorf("expected truncation marker, got %q", got)
	}
}

func TestFormatScalar_Numbers(t *testing.T) {
	if got := formatScalar(float64(42)); got != "42" {
		t.Errorf("expected integer-typed float to format without dot, got %q", got)
	}
	if got := formatScalar(3.14); got != "3.14" {
		t.Errorf("got %q, want 3.14", got)
	}
}

func TestPayloadOneLine_KeysSortedDeterministic(t *testing.T) {
	payload := moltnetapi.TaskMessagePayload{
		"zeta":  jx.Raw(`"z"`),
		"alpha": jx.Raw(`"a"`),
		"beta":  jx.Raw(`"b"`),
	}
	got := payloadOneLine(payload)
	want := `alpha="a" beta="b" zeta="z"`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// ── printMessage ──────────────────────────────────────────────────────────────

func TestPrintMessage_HumanFormat(t *testing.T) {
	var buf bytes.Buffer
	m := moltnetapi.TaskMessage{
		TaskId:    uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		AttemptN:  1,
		Seq:       7,
		Timestamp: time.Date(2026, 5, 9, 13, 24, 25, 0, time.UTC),
		Kind:      moltnetapi.TaskMessageKindTurnEnd,
		Payload:   moltnetapi.TaskMessagePayload{"stop_reason": jx.Raw(`"tool_use"`)},
	}
	if err := printMessage(&buf, "human", m); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got := buf.String()
	for _, want := range []string{"seq=7", "13:24:25", "turn_end", `stop_reason="tool_use"`} {
		if !strings.Contains(got, want) {
			t.Errorf("output missing %q: %q", want, got)
		}
	}
}

func TestPrintMessage_JSONFormat(t *testing.T) {
	var buf bytes.Buffer
	m := moltnetapi.TaskMessage{
		TaskId:    uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		AttemptN:  1,
		Seq:       7,
		Timestamp: time.Date(2026, 5, 9, 13, 24, 25, 0, time.UTC),
		Kind:      moltnetapi.TaskMessageKindError,
		Payload:   moltnetapi.TaskMessagePayload{"phase": jx.Raw(`"x"`)},
	}
	if err := printMessage(&buf, "json", m); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, buf.String())
	}
	if parsed["seq"] != float64(7) || parsed["kind"] != "error" {
		t.Errorf("unexpected JSON: %+v", parsed)
	}
}

// ── runTaskTailCmd integration ───────────────────────────────────────────────

// stubTailHandler implements just the three operations the tail command
// hits: GetTask, ListTaskAttempts, ListTaskMessages. We track call counts
// so tests can assert poll behaviour.
type stubTailHandler struct {
	moltnetapi.UnimplementedHandler

	mu sync.Mutex

	// State machine:
	// - getTaskCalls >= terminalAfter → return Completed status
	// - allMessages is the canonical message store; ListTaskMessages
	//   slices it by AfterSeq + capped at pageSize to mimic real
	//   server pagination
	getTaskCalls         int
	terminalAfter        int
	listMessagesCalls    int
	listMessagesAfterSeq []int // the AfterSeq value seen on each call
	pageSize             int
	allMessages          []moltnetapi.TaskMessage
	listAttemptResp      []moltnetapi.TaskAttempt
}

func (h *stubTailHandler) GetTask(_ context.Context, _ moltnetapi.GetTaskParams) (moltnetapi.GetTaskRes, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.getTaskCalls++
	status := moltnetapi.TaskStatusRunning
	if h.terminalAfter > 0 && h.getTaskCalls >= h.terminalAfter {
		status = moltnetapi.TaskStatusCompleted
	}
	t := &moltnetapi.Task{
		ID:                         uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		TeamId:                     uuid.MustParse("22222222-2222-4222-8222-222222222222"),
		DiaryId:                    moltnetapi.NewNilUUID(uuid.MustParse("33333333-3333-4333-8333-333333333333")),
		TaskType:                   "fulfill_brief",
		Status:                     status,
		Input:                      moltnetapi.TaskInput{},
		InputCid:                   "bagaa1",
		InputSchemaCid:             "bagaa2",
		ImposedByAgentId:           moltnetapi.NewNilUUID(uuid.MustParse("44444444-4444-4444-8444-444444444444")),
		MaxAttempts:                1,
		OutputKind:                 moltnetapi.TaskOutputKindArtifact,
		QueuedAt:                   time.Now().Add(-2 * time.Minute),
		RequiredExecutorTrustLevel: moltnetapi.TaskRequiredExecutorTrustLevelSelfDeclared,
		References:                 []moltnetapi.TaskReferencesItem{},
	}
	t.AcceptedAttemptN.SetToNull()
	t.CancelReason.SetToNull()
	t.CancelledByAgentId.SetToNull()
	t.CancelledByHumanId.SetToNull()
	t.CompletedAt.SetToNull()
	t.CorrelationId.SetToNull()
	t.DispatchTimeoutSec.SetToNull()
	t.ExpiresAt.SetToNull()
	t.ImposedByHumanId.SetToNull()
	t.RunningTimeoutSec.SetToNull()
	return t, nil
}

func (h *stubTailHandler) ListTaskAttempts(_ context.Context, _ moltnetapi.ListTaskAttemptsParams) (moltnetapi.ListTaskAttemptsRes, error) {
	resp := moltnetapi.ListTaskAttemptsOKApplicationJSON(h.listAttemptResp)
	return &resp, nil
}

func (h *stubTailHandler) ListTaskMessages(_ context.Context, params moltnetapi.ListTaskMessagesParams) (moltnetapi.ListTaskMessagesRes, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.listMessagesCalls++
	afterSeq := -1
	if params.AfterSeq.Set {
		afterSeq = params.AfterSeq.Value
	}
	h.listMessagesAfterSeq = append(h.listMessagesAfterSeq, afterSeq)

	// Page by `afterSeq` against the canonical message store. Caps at
	// pageSize messages per call (default 0 = unlimited) so tests can
	// exercise the multi-page latestSeq walk.
	page := make([]moltnetapi.TaskMessage, 0, len(h.allMessages))
	for _, m := range h.allMessages {
		if int(m.Seq) > afterSeq {
			page = append(page, m)
		}
	}
	if h.pageSize > 0 && len(page) > h.pageSize {
		page = page[:h.pageSize]
	}
	resp := moltnetapi.ListTaskMessagesOKApplicationJSON(page)
	return &resp, nil
}

func TestRunTaskTailCmd_TerminatesOnTerminalStatus(t *testing.T) {
	h := &stubTailHandler{
		terminalAfter: 2, // first GetTask says running; second says completed
		listAttemptResp: []moltnetapi.TaskAttempt{
			func() moltnetapi.TaskAttempt {
				a := moltnetapi.TaskAttempt{
					TaskId:           uuid.MustParse("11111111-1111-4111-8111-111111111111"),
					AttemptN:         1,
					ClaimedByAgentId: uuid.MustParse("44444444-4444-4444-8444-444444444444"),
					ClaimedAt:        time.Now().Add(-time.Minute),
					Status:           moltnetapi.TaskAttemptStatusRunning,
				}
				// Optional fields are typed as Nil<T>; defaults pass an
				// empty string through and the response-side min-length
				// validator rejects it. Explicitly null them out.
				a.ClaimedExecutorFingerprint.SetToNull()
				a.CompletedExecutorFingerprint.SetToNull()
				a.OutputCid.SetToNull()
				a.ContentSignature.SetToNull()
				a.ClaimedExecutorManifest.SetToNull()
				a.CompletedExecutorManifest.SetToNull()
				a.Output.SetToNull()
				a.Error.SetToNull()
				a.Usage.SetToNull()
				a.RuntimeId.SetToNull()
				a.CompletedAt.SetToNull()
				a.SignedAt.SetToNull()
				a.StartedAt.SetToNull()
				return a
			}(),
		},
		// All existing backlog messages exist before tail attaches —
		// default mode must skip them entirely. After they're skipped
		// the loop checks GetTask, which returns terminal on the
		// second call, so the loop exits cleanly with no new prints.
		allMessages: []moltnetapi.TaskMessage{
			makeTestMsg(0, moltnetapi.TaskMessageKindInfo, `"started"`),
			makeTestMsg(1, moltnetapi.TaskMessageKindTurnEnd, `"end_turn"`),
		},
	}
	_, _, client := newTestServer(t, h)

	var buf bytes.Buffer
	opts := taskTailOpts{
		taskID:      "11111111-1111-4111-8111-111111111111",
		intervalSec: 1,
		format:      "human",
		out:         &buf,
	}
	if err := runTaskTailWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("tail returned error: %v", err)
	}
	out := buf.String()
	// Backlog (both seq=0 and seq=1) was visible BEFORE we attached;
	// default mode must skip every one of them.
	if strings.Contains(out, `event="started"`) || strings.Contains(out, `event="end_turn"`) {
		t.Errorf("default mode should skip backlog; got: %q", out)
	}
	if h.getTaskCalls < 1 {
		t.Errorf("expected at least 1 GetTask call, got %d", h.getTaskCalls)
	}
}

// Regression: --since 0 must replay seq=0. The server's afterSeq is
// exclusive, so the implementation must omit afterSeq for --since 0.
func TestRunTaskTailCmd_SinceZeroIncludesSeqZero(t *testing.T) {
	h := &stubTailHandler{
		terminalAfter:   1, // terminate immediately so the loop exits after one fetch
		listAttemptResp: []moltnetapi.TaskAttempt{validRunningAttempt()},
		allMessages: []moltnetapi.TaskMessage{
			makeTestMsg(0, moltnetapi.TaskMessageKindInfo, `"first"`),
			makeTestMsg(1, moltnetapi.TaskMessageKindTurnEnd, `"end_turn"`),
		},
	}
	_, _, client := newTestServer(t, h)

	var buf bytes.Buffer
	opts := taskTailOpts{
		taskID:       "11111111-1111-4111-8111-111111111111",
		intervalSec:  1,
		format:       "human",
		out:          &buf,
		since:        0,
		sinceChanged: true,
	}
	if err := runTaskTailWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("tail returned error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, `event="first"`) {
		t.Errorf("--since 0 should include seq=0; output: %q", out)
	}
	if !strings.Contains(out, `event="end_turn"`) {
		t.Errorf("--since 0 should also include later messages; output: %q", out)
	}
}

// Regression: --since N (N > 0) is INCLUSIVE — print seq >= N. The
// implementation passes afterSeq=N-1 to the exclusive server cursor.
func TestRunTaskTailCmd_SinceNIsInclusive(t *testing.T) {
	h := &stubTailHandler{
		terminalAfter:   1,
		listAttemptResp: []moltnetapi.TaskAttempt{validRunningAttempt()},
		allMessages: []moltnetapi.TaskMessage{
			makeTestMsg(0, moltnetapi.TaskMessageKindInfo, `"earlier"`),
			makeTestMsg(1, moltnetapi.TaskMessageKindInfo, `"target"`),
			makeTestMsg(2, moltnetapi.TaskMessageKindTurnEnd, `"end_turn"`),
		},
	}
	_, _, client := newTestServer(t, h)

	var buf bytes.Buffer
	opts := taskTailOpts{
		taskID:       "11111111-1111-4111-8111-111111111111",
		intervalSec:  1,
		format:       "human",
		out:          &buf,
		since:        1,
		sinceChanged: true,
	}
	if err := runTaskTailWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("tail returned error: %v", err)
	}
	out := buf.String()
	if strings.Contains(out, `event="earlier"`) {
		t.Errorf("--since 1 should skip seq=0; output: %q", out)
	}
	if !strings.Contains(out, `event="target"`) {
		t.Errorf("--since 1 should include seq=1; output: %q", out)
	}
}

// Regression: a fully-filtered page (e.g. all text_delta with default
// suppression) must still advance the cursor — otherwise the next poll
// re-fetches the same page and the loop spins.
func TestRunTaskTailCmd_FilteredPageStillAdvancesCursor(t *testing.T) {
	h := &stubTailHandler{
		terminalAfter:   3, // running, running, then terminal
		listAttemptResp: []moltnetapi.TaskAttempt{validRunningAttempt()},
		allMessages: []moltnetapi.TaskMessage{
			// First poll page: 2x text_delta (suppressed by default)
			makeTestMsg(0, moltnetapi.TaskMessageKindTextDelta, `"a"`),
			makeTestMsg(1, moltnetapi.TaskMessageKindTextDelta, `"b"`),
			// Second poll: visible message — must NOT include seq=0,1 again
			makeTestMsg(2, moltnetapi.TaskMessageKindTurnEnd, `"end_turn"`),
		},
	}
	_, _, client := newTestServer(t, h)

	var buf bytes.Buffer
	opts := taskTailOpts{
		taskID:       "11111111-1111-4111-8111-111111111111",
		intervalSec:  1,
		format:       "human",
		out:          &buf,
		since:        0,
		sinceChanged: true,
	}
	if err := runTaskTailWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("tail returned error: %v", err)
	}
	// Inspect the AfterSeq sequence the handler observed. After the
	// first fetch (which returned seqs 0,1, all suppressed), the
	// cursor must be > 1 — otherwise the implementation didn't
	// advance past suppressed messages.
	if len(h.listMessagesAfterSeq) < 2 {
		t.Fatalf("expected at least 2 ListTaskMessages calls, got %d", len(h.listMessagesAfterSeq))
	}
	// Call 1 was the initial fetch with --since 0 (afterSeq omitted = -1).
	// Call 2 should have afterSeq >= 1 (meaning seqs 0,1 were consumed).
	if h.listMessagesAfterSeq[1] < 1 {
		t.Errorf("filtered page didn't advance cursor: 2nd-call afterSeq=%d (want >= 1); call sequence: %v",
			h.listMessagesAfterSeq[1], h.listMessagesAfterSeq)
	}
}

// Regression: latestSeq must walk through ALL pages of backlog, not
// just the first page. Otherwise default-mode tail prints stale
// backlog as if it were live.
func TestRunTaskTailCmd_LatestSeqWalksAllBacklogPages(t *testing.T) {
	h := &stubTailHandler{
		terminalAfter:   1, // terminate after first poll
		listAttemptResp: []moltnetapi.TaskAttempt{validRunningAttempt()},
		// Page size 5, but we have 12 backlog messages → multi-page.
		pageSize: 5,
		allMessages: []moltnetapi.TaskMessage{
			makeTestMsg(0, moltnetapi.TaskMessageKindInfo, `"a0"`),
			makeTestMsg(1, moltnetapi.TaskMessageKindInfo, `"a1"`),
			makeTestMsg(2, moltnetapi.TaskMessageKindInfo, `"a2"`),
			makeTestMsg(3, moltnetapi.TaskMessageKindInfo, `"a3"`),
			makeTestMsg(4, moltnetapi.TaskMessageKindInfo, `"a4"`),
			makeTestMsg(5, moltnetapi.TaskMessageKindInfo, `"a5"`),
			makeTestMsg(6, moltnetapi.TaskMessageKindInfo, `"a6"`),
			makeTestMsg(7, moltnetapi.TaskMessageKindInfo, `"a7"`),
			makeTestMsg(8, moltnetapi.TaskMessageKindInfo, `"a8"`),
			makeTestMsg(9, moltnetapi.TaskMessageKindInfo, `"a9"`),
			makeTestMsg(10, moltnetapi.TaskMessageKindInfo, `"a10"`),
			makeTestMsg(11, moltnetapi.TaskMessageKindInfo, `"a11"`),
		},
	}
	_, _, client := newTestServer(t, h)

	var buf bytes.Buffer
	opts := taskTailOpts{
		taskID:      "11111111-1111-4111-8111-111111111111",
		intervalSec: 1,
		format:      "human",
		out:         &buf,
		// Default mode (sinceChanged=false): latestSeq must page
		// through the 12 backlog entries before locking the cursor.
	}
	if err := runTaskTailWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("tail returned error: %v", err)
	}
	// Default mode skips backlog: NONE of "a0" through "a11" should
	// appear in the output. If latestSeq only walked the first page
	// it would lock cursor at seq=4, then the first poll would emit
	// seqs 5..11 as if they were new.
	for i := 0; i <= 11; i++ {
		needle := fmt.Sprintf(`event="a%d"`, i)
		if strings.Contains(buf.String(), needle) {
			t.Errorf("default mode leaked backlog seq=%d (%q); output: %q", i, needle, buf.String())
		}
	}
}

// Test helper — minimal valid TaskAttempt with all Nil<T> fields nulled
// so the response-side validator accepts it.
func validRunningAttempt() moltnetapi.TaskAttempt {
	a := moltnetapi.TaskAttempt{
		TaskId:           uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		AttemptN:         1,
		ClaimedByAgentId: uuid.MustParse("44444444-4444-4444-8444-444444444444"),
		ClaimedAt:        time.Now().Add(-time.Minute),
		Status:           moltnetapi.TaskAttemptStatusRunning,
	}
	a.ClaimedExecutorFingerprint.SetToNull()
	a.CompletedExecutorFingerprint.SetToNull()
	a.OutputCid.SetToNull()
	a.ContentSignature.SetToNull()
	a.ClaimedExecutorManifest.SetToNull()
	a.CompletedExecutorManifest.SetToNull()
	a.Output.SetToNull()
	a.Error.SetToNull()
	a.Usage.SetToNull()
	a.RuntimeId.SetToNull()
	a.CompletedAt.SetToNull()
	a.SignedAt.SetToNull()
	a.StartedAt.SetToNull()
	return a
}

func makeTestMsg(seq int, kind moltnetapi.TaskMessageKind, payloadJSON string) moltnetapi.TaskMessage {
	return moltnetapi.TaskMessage{
		TaskId:    uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		AttemptN:  1,
		Seq:       float64(seq),
		Timestamp: time.Now().UTC(),
		Kind:      kind,
		Payload:   moltnetapi.TaskMessagePayload{"event": jx.Raw(payloadJSON)},
	}
}
