package moltnetapi

import "testing"

func TestCreateTaskReqExposesTitleField(t *testing.T) {
	t.Parallel()

	req := CreateTaskReq{}
	req.Title = NewOptString("Smoke title")

	if !req.Title.Set || req.Title.Value != "Smoke title" {
		t.Fatalf("title = %q (set=%v), want Smoke title", req.Title.Value, req.Title.Set)
	}
}
