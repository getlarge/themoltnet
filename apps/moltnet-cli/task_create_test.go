package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/go-faster/jx"
	"github.com/google/uuid"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// stubCreateHandler combines schema listing (for client-side validation) with
// task creation. Both endpoints share state so tests can assert call counts
// and the request body the server would have seen.
type stubCreateHandler struct {
	moltnetapi.UnimplementedHandler

	mu           sync.Mutex
	schemaCalls  int
	createCalls  int
	descriptors  []moltnetapi.TaskTypeDescriptor
	lastCreate   *moltnetapi.CreateTaskReq
	lastParams   moltnetapi.CreateTaskParams
	createReturn moltnetapi.CreateTaskRes // override; nil → newTaskFixture
}

func (h *stubCreateHandler) ListTaskSchemas(_ context.Context) (moltnetapi.ListTaskSchemasRes, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.schemaCalls++
	return &moltnetapi.ListTaskSchemasResponse{Items: h.descriptors}, nil
}

func (h *stubCreateHandler) CreateTask(_ context.Context, req *moltnetapi.CreateTaskReq, params moltnetapi.CreateTaskParams) (moltnetapi.CreateTaskRes, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.createCalls++
	// Copy so later mutations by the generated decoder don't race with reads.
	cp := *req
	h.lastCreate = &cp
	h.lastParams = params
	if h.createReturn != nil {
		return h.createReturn, nil
	}
	return newTaskFixture(uuid.Nil, params.XMoltnetTeamID), nil
}

func (h *stubCreateHandler) counts() (schema, create int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.schemaCalls, h.createCalls
}

// fulfillBriefSchema describes the minimum closed-shape schema used by these
// tests: object with required `brief` (string ≥ 1 char) and an optional
// `scopeHint` enum. Keeps the tests independent of the live registry while
// exercising path-prefixed validation errors.
func fulfillBriefSchema() moltnetapi.TaskTypeDescriptor {
	return moltnetapi.TaskTypeDescriptor{
		TaskType:       "fulfill_brief",
		OutputKind:     moltnetapi.TaskTypeDescriptorOutputKindArtifact,
		InputSchemaCid: "bafy-fulfill",
		InputSchema: moltnetapi.TaskTypeDescriptorInputSchema{
			"$schema":              jx.Raw(`"https://json-schema.org/draft/2020-12/schema"`),
			"type":                 jx.Raw(`"object"`),
			"required":             jx.Raw(`["brief"]`),
			"additionalProperties": jx.Raw(`false`),
			"properties": jx.Raw(`{
				"brief": {"type":"string","minLength":1},
				"title": {"type":"string"},
				"scopeHint": {"type":"string","enum":["misc","refactor","bugfix","feature"]}
			}`),
		},
	}
}

func newCreateOpts(stdinJSON string) taskCreateOpts {
	return taskCreateOpts{
		taskType:  "fulfill_brief",
		teamID:    "22222222-2222-4222-8222-222222222222",
		diaryID:   "33333333-3333-4333-8333-333333333333",
		inputFile: "-", // read stdin
		stdin:     strings.NewReader(stdinJSON),
	}
}

func TestRunTaskCreate_Happy(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	var out bytes.Buffer
	opts := newCreateOpts(`{"brief":"smoke test","scopeHint":"misc"}`)
	opts.title = "Smoke title"
	opts.titleSet = true
	opts.out = &out

	if err := runTaskCreateWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("runTaskCreateWithClient: %v", err)
	}
	schemaN, createN := h.counts()
	if schemaN != 1 || createN != 1 {
		t.Errorf("expected schema=1 create=1, got schema=%d create=%d", schemaN, createN)
	}
	// Output must be JSON-parseable into a Task envelope.
	var got moltnetapi.Task
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal task: %v\noutput=%s", err, out.String())
	}
	if got.TaskType != "fulfill_brief" {
		t.Errorf("Task.TaskType = %q, want fulfill_brief", got.TaskType)
	}

	// The handler captured the wire body; assert input fields survived.
	if h.lastCreate == nil {
		t.Fatal("handler did not capture a CreateTaskReq")
	}
	if h.lastCreate.TaskType != "fulfill_brief" {
		t.Errorf("CreateTaskReq.TaskType = %q", h.lastCreate.TaskType)
	}
	title, ok := h.lastCreate.Title.Get()
	if !ok || title != "Smoke title" {
		t.Errorf("CreateTaskReq.Title = %q (set=%v), want Smoke title", title, ok)
	}
	briefRaw, ok := h.lastCreate.Input["brief"]
	if !ok {
		t.Fatal("Input.brief missing from wire body")
	}
	if string(briefRaw) != `"smoke test"` {
		t.Errorf("Input.brief = %s, want \"smoke test\"", briefRaw)
	}
}

func TestRunTaskCreate_DryRunPrintsCanonicalBody(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	var out bytes.Buffer
	opts := newCreateOpts(`{"brief":"dry","scopeHint":"misc"}`)
	opts.out = &out
	opts.dryRun = true

	if err := runTaskCreateWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("runTaskCreateWithClient: %v", err)
	}
	_, createN := h.counts()
	if createN != 0 {
		t.Errorf("expected zero CreateTask calls in dry-run, got %d", createN)
	}
	// Parse the dry-run output rather than grepping for whitespace-sensitive
	// substrings — the indent format is operator-facing but not a test invariant.
	var body map[string]any
	if err := json.Unmarshal(out.Bytes(), &body); err != nil {
		t.Fatalf("dry-run output is not valid JSON: %v\n%s", err, out.String())
	}
	if body["taskType"] != "fulfill_brief" {
		t.Errorf("dry-run taskType = %v, want fulfill_brief", body["taskType"])
	}
	inputObj, ok := body["input"].(map[string]any)
	if !ok {
		t.Fatalf("dry-run input not an object: %v", body["input"])
	}
	if inputObj["brief"] != "dry" {
		t.Errorf("dry-run input.brief = %v, want \"dry\"", inputObj["brief"])
	}
}

func TestRunTaskCreate_OutputId(t *testing.T) {
	wantID := uuid.MustParse("a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	h := &stubCreateHandler{
		descriptors:  []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()},
		createReturn: newTaskFixture(wantID, uuid.Nil),
	}
	_, _, client := newTestServer(t, h)

	var out bytes.Buffer
	opts := newCreateOpts(`{"brief":"id-mode","scopeHint":"misc"}`)
	opts.out = &out
	opts.outputMode = "id"

	if err := runTaskCreateWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("runTaskCreateWithClient: %v", err)
	}
	got := strings.TrimSpace(out.String())
	if got != wantID.String() {
		t.Errorf("--output id stdout = %q, want %q", got, wantID.String())
	}
}

func TestRunTaskCreate_ReferenceRoundTrip(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"with-refs","scopeHint":"misc"}`)
	opts.out = io.Discard
	opts.references = []string{
		`{"taskId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"context","outputCid":"bafy-A"}`,
		`{"taskId":null,"role":"context","outputCid":"gh:issue:42","external":{"kind":"github_issue","issue":42}}`,
	}

	if err := runTaskCreateWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("runTaskCreateWithClient: %v", err)
	}
	if h.lastCreate == nil || len(h.lastCreate.References) != 2 {
		t.Fatalf("expected 2 References, got %v", h.lastCreate)
	}
	r0 := h.lastCreate.References[0]
	taskIDVal, ok := r0.TaskId.Get()
	if !ok || taskIDVal.String() != "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" {
		t.Errorf("Reference[0].TaskId set=%v, value=%v", ok, taskIDVal)
	}
	if r0.Role != moltnetapi.TaskRefRoleContext {
		t.Errorf("Reference[0].Role = %q, want context", r0.Role)
	}
	r1 := h.lastCreate.References[1]
	ext, ok := r1.External.Get()
	if !ok {
		t.Fatal("Reference[1].External not set")
	}
	if ext.Kind != moltnetapi.TaskRefExternalKindGithubIssue {
		t.Errorf("Reference[1].External.Kind = %q", ext.Kind)
	}
	issueVal, ok := ext.Issue.Get()
	if !ok || issueVal != 42 {
		t.Errorf("Reference[1].External.Issue set=%v value=%v", ok, issueVal)
	}
}

func TestRunTaskCreate_AllowedProfileRoundTrip(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"with-execs"}`)
	opts.out = io.Discard
	opts.allowedProfiles = []string{
		`{"profileId":"11111111-1111-4111-8111-111111111111"}`,
		`{"profileId":"22222222-2222-4222-8222-222222222222"}`,
	}

	if err := runTaskCreateWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("runTaskCreateWithClient: %v", err)
	}
	if len(h.lastCreate.AllowedProfiles) != 2 {
		t.Fatalf("expected 2 AllowedProfiles, got %d", len(h.lastCreate.AllowedProfiles))
	}
	if h.lastCreate.AllowedProfiles[0].ProfileId.String() != "11111111-1111-4111-8111-111111111111" {
		t.Errorf("AllowedProfiles[0].ProfileId = %q", h.lastCreate.AllowedProfiles[0].ProfileId)
	}
	if h.lastCreate.AllowedProfiles[1].ProfileId.String() != "22222222-2222-4222-8222-222222222222" {
		t.Errorf("AllowedProfiles[1].ProfileId = %q", h.lastCreate.AllowedProfiles[1].ProfileId)
	}
}

func TestRunTaskCreate_BadReferenceJSON(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"x"}`)
	opts.out = io.Discard
	opts.references = []string{`{not-json`}

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for invalid --reference JSON")
	}
	if !strings.Contains(err.Error(), "--reference #1") {
		t.Errorf("error should index the bad flag (1-based): %s", err.Error())
	}
	_, createN := h.counts()
	if createN != 0 {
		t.Errorf("CreateTask must not be called on bad --reference, got %d", createN)
	}
}

func TestRunTaskCreate_BadInputJSON(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`not-json-at-all`)
	opts.out = io.Discard

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for invalid --input-file JSON")
	}
	if !strings.Contains(err.Error(), "--input-file") {
		t.Errorf("error should name --input-file: %s", err.Error())
	}
	schemaN, createN := h.counts()
	if schemaN != 0 || createN != 0 {
		t.Errorf("bad input must short-circuit before any network call, got schema=%d create=%d", schemaN, createN)
	}
}

func TestRunTaskCreate_InputNotObject(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`["not","an","object"]`)
	opts.out = io.Discard

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for array-shaped input")
	}
	if !strings.Contains(err.Error(), "must be a JSON object") {
		t.Errorf("error should explain shape requirement: %s", err.Error())
	}
}

func TestRunTaskCreate_SchemaValidationMissingRequiredField(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{}`) // missing brief
	opts.out = io.Discard

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected validation error for missing brief")
	}
	if !strings.Contains(err.Error(), "input validation failed for taskType=fulfill_brief") {
		t.Errorf("error missing context: %s", err.Error())
	}
	// JSON-Pointer style path on at least one line.
	if !strings.Contains(err.Error(), "brief") {
		t.Errorf("error should name the missing field: %s", err.Error())
	}
	_, createN := h.counts()
	if createN != 0 {
		t.Errorf("CreateTask must not be called on schema failure, got %d", createN)
	}
}

func TestRunTaskCreate_SchemaValidationWrongEnum(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"x","scopeHint":"weird"}`)
	opts.out = io.Discard

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected validation error for bad enum")
	}
	if !strings.Contains(err.Error(), "scopeHint") {
		t.Errorf("error should name the offending field: %s", err.Error())
	}
}

func TestRunTaskCreate_SkipValidationBypassesFetch(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	// Intentionally invalid input — but the CLI shouldn't notice.
	opts := newCreateOpts(`{}`)
	opts.out = io.Discard
	opts.skipValidation = true

	if err := runTaskCreateWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("runTaskCreateWithClient: %v", err)
	}
	schemaN, createN := h.counts()
	if schemaN != 0 {
		t.Errorf("--skip-validation must skip ListTaskSchemas, got %d calls", schemaN)
	}
	if createN != 1 {
		t.Errorf("expected one CreateTask call, got %d", createN)
	}
}

func TestRunTaskCreate_UnknownTaskTypeAtValidation(t *testing.T) {
	// Server reports schemas for fulfill_brief only; caller asks for nope.
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"x"}`)
	opts.out = io.Discard
	opts.taskType = "nope_task"

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for unknown task type")
	}
	if !strings.Contains(err.Error(), `"nope_task"`) {
		t.Errorf("error should name the missing type: %s", err.Error())
	}
	if !strings.Contains(err.Error(), "fulfill_brief") {
		t.Errorf("error should list the known types: %s", err.Error())
	}
}

func TestRunTaskCreate_InvalidTrustLevelRejectedClientSide(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"x"}`)
	opts.out = io.Discard
	opts.requiredExecutorTrustLevel = "MAXIMUM_TRUST"
	opts.requiredExecutorTrustLevelSet = true

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for invalid trust level")
	}
	if !strings.Contains(err.Error(), "MAXIMUM_TRUST") {
		t.Errorf("error should echo the bad value: %s", err.Error())
	}
	schemaN, createN := h.counts()
	if schemaN != 0 || createN != 0 {
		t.Errorf("client-side rejection must short-circuit, got schema=%d create=%d", schemaN, createN)
	}
}

func TestRunTaskCreate_CorrelationIDAndTimeouts(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	corr := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	opts := newCreateOpts(`{"brief":"x"}`)
	opts.out = io.Discard
	opts.correlationID = corr
	opts.correlationIDSet = true
	opts.dispatchTimeoutSec = 60
	opts.dispatchTimeoutSecSet = true
	opts.runningTimeoutSec = 3600
	opts.runningTimeoutSecSet = true
	opts.expiresInSec = 7200
	opts.expiresInSecSet = true
	opts.maxAttempts = 5
	opts.maxAttemptsSet = true

	if err := runTaskCreateWithClient(context.Background(), client, opts); err != nil {
		t.Fatalf("runTaskCreateWithClient: %v", err)
	}
	if h.lastCreate == nil {
		t.Fatal("no CreateTaskReq captured")
	}
	gotCorr, ok := h.lastCreate.CorrelationId.Get()
	if !ok || gotCorr.String() != corr {
		t.Errorf("CorrelationId set=%v value=%v want=%s", ok, gotCorr, corr)
	}
	for name, opt := range map[string]moltnetapi.OptInt{
		"DispatchTimeoutSec": h.lastCreate.DispatchTimeoutSec,
		"RunningTimeoutSec":  h.lastCreate.RunningTimeoutSec,
		"ExpiresInSec":       h.lastCreate.ExpiresInSec,
		"MaxAttempts":        h.lastCreate.MaxAttempts,
	} {
		v, ok := opt.Get()
		if !ok || v <= 0 {
			t.Errorf("%s not set or non-positive: %v / %v", name, ok, v)
		}
	}
}

func TestRunTaskCreate_NegativeTimeoutRejected(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"x"}`)
	opts.out = io.Discard
	opts.dispatchTimeoutSec = -1
	opts.dispatchTimeoutSecSet = true

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for negative timeout")
	}
	if !strings.Contains(err.Error(), "dispatch-timeout-sec") {
		t.Errorf("error should name the flag: %s", err.Error())
	}
}

func TestRunTaskCreate_EmptyInputRejected(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts("   \n   ") // whitespace-only stdin
	opts.out = io.Discard

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for empty input")
	}
	if !strings.Contains(err.Error(), "empty") {
		t.Errorf("error should say empty: %s", err.Error())
	}
}

func TestRunTaskCreate_UnknownOutputMode(t *testing.T) {
	h := &stubCreateHandler{descriptors: []moltnetapi.TaskTypeDescriptor{fulfillBriefSchema()}}
	_, _, client := newTestServer(t, h)

	opts := newCreateOpts(`{"brief":"x"}`)
	opts.out = io.Discard
	opts.outputMode = "yaml"

	err := runTaskCreateWithClient(context.Background(), client, opts)
	if err == nil {
		t.Fatal("expected error for unknown --output mode")
	}
	if !strings.Contains(err.Error(), "yaml") {
		t.Errorf("error should echo the bad mode: %s", err.Error())
	}
}
