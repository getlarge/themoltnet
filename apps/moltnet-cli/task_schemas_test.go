package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/go-faster/jx"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// stubSchemasHandler returns a fixed list of TaskTypeDescriptors and counts
// how many times ListTaskSchemas was hit — exercised in tests that want to
// assert request count, e.g. cache parity once PR 2 lands.
type stubSchemasHandler struct {
	moltnetapi.UnimplementedHandler

	mu          sync.Mutex
	listCalls   int
	descriptors []moltnetapi.TaskTypeDescriptor
}

func (h *stubSchemasHandler) ListTaskSchemas(_ context.Context) (moltnetapi.ListTaskSchemasRes, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.listCalls++
	return &moltnetapi.ListTaskSchemasResponse{Items: h.descriptors}, nil
}

func (h *stubSchemasHandler) calls() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.listCalls
}

func newSchemaDescriptors() []moltnetapi.TaskTypeDescriptor {
	// Two descriptors with distinct cids so cache lookups are unambiguous.
	// Schema content kept minimal — these tests cover the listing /
	// rendering path; full schema validation belongs to PR 2.
	fulfill := moltnetapi.TaskTypeDescriptor{
		TaskType:       "fulfill_brief",
		OutputKind:     moltnetapi.TaskTypeDescriptorOutputKindArtifact,
		InputSchemaCid: "bafy-fulfill",
		InputSchema: moltnetapi.TaskTypeDescriptorInputSchema{
			"type":     jx.Raw(`"object"`),
			"required": jx.Raw(`["brief"]`),
		},
	}
	assess := moltnetapi.TaskTypeDescriptor{
		TaskType:       "assess_brief",
		OutputKind:     moltnetapi.TaskTypeDescriptorOutputKindJudgment,
		InputSchemaCid: "bafy-assess",
		InputSchema: moltnetapi.TaskTypeDescriptorInputSchema{
			"type": jx.Raw(`"object"`),
		},
	}
	return []moltnetapi.TaskTypeDescriptor{fulfill, assess}
}

func TestRunTaskSchemasList_ReturnsSortedDescriptors(t *testing.T) {
	h := &stubSchemasHandler{descriptors: newSchemaDescriptors()}
	_, _, client := newTestServer(t, h)

	var out bytes.Buffer
	if err := runTaskSchemasListWithClient(context.Background(), client, &out); err != nil {
		t.Fatalf("runTaskSchemasListWithClient: %v", err)
	}
	if h.calls() != 1 {
		t.Fatalf("expected exactly one ListTaskSchemas call, got %d", h.calls())
	}

	var rows []struct {
		TaskType       string `json:"taskType"`
		OutputKind     string `json:"outputKind"`
		InputSchemaCid string `json:"inputSchemaCid"`
	}
	if err := json.Unmarshal(out.Bytes(), &rows); err != nil {
		t.Fatalf("unmarshal output: %v\noutput=%s", err, out.String())
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	// Sort assertion: assess_brief comes before fulfill_brief alphabetically.
	if rows[0].TaskType != "assess_brief" || rows[1].TaskType != "fulfill_brief" {
		t.Errorf("rows not sorted: got %+v", rows)
	}
	if rows[0].OutputKind != "judgment" || rows[1].OutputKind != "artifact" {
		t.Errorf("outputKind mismatch: got %+v", rows)
	}
	if rows[0].InputSchemaCid != "bafy-assess" || rows[1].InputSchemaCid != "bafy-fulfill" {
		t.Errorf("inputSchemaCid mismatch: got %+v", rows)
	}
}

func TestRunTaskSchemasGet_KnownType(t *testing.T) {
	h := &stubSchemasHandler{descriptors: newSchemaDescriptors()}
	_, _, client := newTestServer(t, h)

	var out bytes.Buffer
	if err := runTaskSchemasGetWithClient(context.Background(), client, "fulfill_brief", &out); err != nil {
		t.Fatalf("runTaskSchemasGetWithClient: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal schema: %v\noutput=%s", err, out.String())
	}
	if got["type"] != "object" {
		t.Errorf("schema.type = %v, want \"object\"", got["type"])
	}
	required, ok := got["required"].([]any)
	if !ok || len(required) != 1 || required[0] != "brief" {
		t.Errorf("schema.required = %v, want [\"brief\"]", got["required"])
	}
}

func TestRunTaskSchemasGet_UnknownType(t *testing.T) {
	h := &stubSchemasHandler{descriptors: newSchemaDescriptors()}
	_, _, client := newTestServer(t, h)

	var out bytes.Buffer
	err := runTaskSchemasGetWithClient(context.Background(), client, "nope_task", &out)
	if err == nil {
		t.Fatalf("expected error for unknown task type")
	}
	// Message should name the unknown type AND list the known set so the
	// operator can self-correct without a second invocation.
	msg := err.Error()
	if !strings.Contains(msg, `"nope_task"`) {
		t.Errorf("error missing offending type: %s", msg)
	}
	if !strings.Contains(msg, "fulfill_brief") || !strings.Contains(msg, "assess_brief") {
		t.Errorf("error missing known types list: %s", msg)
	}
}

func TestRunTaskSchemasGet_MissingTaskTypeArg(t *testing.T) {
	h := &stubSchemasHandler{descriptors: newSchemaDescriptors()}
	_, _, client := newTestServer(t, h)

	var out bytes.Buffer
	err := runTaskSchemasGetWithClient(context.Background(), client, "", &out)
	if err == nil {
		t.Fatalf("expected error when --task-type is empty")
	}
	if !strings.Contains(err.Error(), "task-type") {
		t.Errorf("error should mention --task-type flag: %s", err.Error())
	}
}
