package main

import (
	"bytes"
	"context"
	"encoding/json"
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
	// - listMessages returns chunks[i] on call i; capped at the last chunk
	getTaskCalls    int
	terminalAfter   int
	listMessages    int
	chunks          [][]moltnetapi.TaskMessage
	listAttemptResp []moltnetapi.TaskAttempt
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
	idx := h.listMessages
	h.listMessages++
	if idx >= len(h.chunks) {
		idx = len(h.chunks) - 1
	}
	chunk := h.chunks[idx]
	// Filter by AfterSeq to mimic server pagination semantics so the
	// tail loop doesn't see the same message twice across polls.
	if params.AfterSeq.Set {
		filtered := chunk[:0]
		for _, m := range chunk {
			if int(m.Seq) > params.AfterSeq.Value {
				filtered = append(filtered, m)
			}
		}
		chunk = filtered
	}
	resp := moltnetapi.ListTaskMessagesOKApplicationJSON(chunk)
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
		chunks: [][]moltnetapi.TaskMessage{
			// First call (latestSeq probe): one existing message, seq=0
			{makeTestMsg(0, moltnetapi.TaskMessageKindInfo, `"started"`)},
			// Second call (after-seq=0 first poll iteration): one new
			{makeTestMsg(1, moltnetapi.TaskMessageKindTurnEnd, `"end_turn"`)},
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
	// We bypass the credential-loading path by injecting the client
	// directly; runTaskTailCmd calls newClientFromCreds, so we adapt
	// by extracting the inner loop for testability.
	if err := runTaskTailWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("tail returned error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "turn_end") {
		t.Errorf("expected turn_end message in output, got: %q", out)
	}
	if h.getTaskCalls < 1 {
		t.Errorf("expected at least 1 GetTask call, got %d", h.getTaskCalls)
	}
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
