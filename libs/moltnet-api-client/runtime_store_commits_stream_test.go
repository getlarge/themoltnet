package moltnetapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/ogen-go/ogen/ogenerrors"
)

type commitStreamSecurity struct{}

func (commitStreamSecurity) AgentKeyAuth(context.Context, OperationName) (AgentKeyAuth, error) {
	return AgentKeyAuth{Token: "test-key"}, nil
}
func (commitStreamSecurity) BearerAuth(context.Context, OperationName) (BearerAuth, error) {
	return BearerAuth{}, ogenerrors.ErrSkipClientSecurity
}
func (commitStreamSecurity) CookieAuth(context.Context, OperationName) (CookieAuth, error) {
	return CookieAuth{}, ogenerrors.ErrSkipClientSecurity
}
func (commitStreamSecurity) SessionAuth(context.Context, OperationName) (SessionAuth, error) {
	return SessionAuth{}, ogenerrors.ErrSkipClientSecurity
}

type commitStreamTransport func(*http.Request) (*http.Response, error)

func (f commitStreamTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type trackedCommitBody struct {
	reader io.Reader
	reads  int
	closed bool
}

func (b *trackedCommitBody) Read(p []byte) (int, error) {
	b.reads++
	return b.reader.Read(p)
}
func (b *trackedCommitBody) Close() error {
	b.closed = true
	return nil
}

func TestListRuntimeStoreCommitsStreamsAndCloses(t *testing.T) {
	storeID := uuid.New()
	teamID := uuid.New()
	body := &trackedCommitBody{reader: strings.NewReader("{\"seq\":1}\n{\"seq\":2}\n")}
	client, err := NewClient("https://example.test/api", commitStreamSecurity{}, WithClient(&http.Client{
		Transport: commitStreamTransport(func(req *http.Request) (*http.Response, error) {
			if req.URL.Path != "/api/runtime-sessions/durable/"+storeID.String()+"/commits" {
				t.Errorf("unexpected path: %s", req.URL.Path)
			}
			if req.Header.Get("Authorization") != "Bearer test-key" || req.Header.Get("x-moltnet-team-id") != teamID.String() {
				t.Errorf("missing auth or team header: %v", req.Header)
			}
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/x-ndjson"}}, Body: body}, nil
		}),
	}))
	if err != nil {
		t.Fatal(err)
	}

	res, err := client.ListRuntimeStoreCommits(context.Background(), ListRuntimeStoreCommitsParams{StoreId: storeID, XMoltnetTeamID: teamID})
	if err != nil {
		t.Fatal(err)
	}
	stream, ok := res.(*ListRuntimeStoreCommitsOK)
	if !ok {
		t.Fatalf("unexpected response: %T", res)
	}
	if body.reads != 0 || body.closed {
		t.Fatalf("response was consumed before return: reads=%d closed=%v", body.reads, body.closed)
	}
	first := make([]byte, len("{\"seq\":1}\n"))
	if _, err := io.ReadFull(stream.Data, first); err != nil || string(first) != "{\"seq\":1}\n" {
		t.Fatalf("first commit: %q, %v", first, err)
	}
	if err := stream.Close(); err != nil || !body.closed {
		t.Fatalf("stream close: %v, body closed=%v", err, body.closed)
	}
}

func TestListRuntimeStoreCommitsClosesInvalidResponse(t *testing.T) {
	body := &trackedCommitBody{reader: strings.NewReader("unexpected")}
	client, err := NewClient("https://example.test", commitStreamSecurity{}, WithClient(&http.Client{
		Transport: commitStreamTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/plain"}}, Body: body}, nil
		}),
	}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ListRuntimeStoreCommits(context.Background(), ListRuntimeStoreCommitsParams{StoreId: uuid.New(), XMoltnetTeamID: uuid.New()})
	if err == nil || !body.closed {
		t.Fatalf("invalid response: err=%v, body closed=%v", err, body.closed)
	}
}

func TestCommitResponseStreamFinishesAtEOF(t *testing.T) {
	body := &trackedCommitBody{reader: strings.NewReader("commit")}
	finishes := 0
	stream := &commitResponseStream{ReadCloser: body, onFinish: func(err error) {
		finishes++
		if err != nil {
			t.Errorf("unexpected finish error: %v", err)
		}
	}}
	if _, err := io.ReadAll(stream); err != nil {
		t.Fatal(err)
	}
	if !body.closed || finishes != 1 {
		t.Fatalf("EOF did not finish stream: closed=%v finishes=%d", body.closed, finishes)
	}
	if err := stream.Close(); err != nil || finishes != 1 {
		t.Fatalf("close after EOF: err=%v finishes=%d", err, finishes)
	}
}

type failingCommitReader struct{ err error }

func (r failingCommitReader) Read([]byte) (int, error) { return 0, r.err }

func TestCommitResponseStreamReportsLateReadError(t *testing.T) {
	readErr := errors.New("stream interrupted")
	body := &trackedCommitBody{reader: failingCommitReader{err: readErr}}
	var finishedErr error
	stream := &commitResponseStream{ReadCloser: body, onFinish: func(err error) { finishedErr = err }}
	if _, err := stream.Read(make([]byte, 8)); !errors.Is(err, readErr) {
		t.Fatalf("read error: %v", err)
	}
	if !body.closed || !errors.Is(finishedErr, readErr) {
		t.Fatalf("late read error was not reported: closed=%v finish=%v", body.closed, finishedErr)
	}
}
