package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/go-faster/jx"
	"github.com/google/uuid"
	"github.com/santhosh-tekuri/jsonschema/v5"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

type taskCreateOpts struct {
	apiURL   string
	credPath string

	taskType  string
	title     string
	titleSet  bool
	teamID    string
	diaryID   string
	inputFile string // "-" or path; empty defaults to stdin

	correlationID    string
	correlationIDSet bool

	references       []string // raw JSON blobs, each a TaskRef
	allowedExecutors []string // raw JSON blobs, each an ExecutorRef

	requiredExecutorTrustLevel    string
	requiredExecutorTrustLevelSet bool

	dispatchTimeoutSec    int
	dispatchTimeoutSecSet bool
	runningTimeoutSec     int
	runningTimeoutSecSet  bool
	expiresInSec          int
	expiresInSecSet       bool
	maxAttempts           int
	maxAttemptsSet        bool

	skipValidation bool
	dryRun         bool
	outputMode     string // "json" or "id"

	stdin io.Reader
	out   io.Writer
}

func runTaskCreateCmd(opts taskCreateOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskCreateWithClient(context.Background(), client, opts)
}

func runTaskCreateWithClient(ctx context.Context, client *moltnetapi.Client, opts taskCreateOpts) error {
	if opts.stdin == nil {
		opts.stdin = os.Stdin
	}
	if opts.out == nil {
		opts.out = os.Stdout
	}

	req, err := buildCreateTaskReq(opts)
	if err != nil {
		return err
	}

	if !opts.skipValidation {
		if err := validateTaskInputAgainstServer(ctx, client, opts.taskType, req.Input); err != nil {
			return err
		}
	}

	if opts.dryRun {
		// Marshal the canonical wire body so the operator can pipe it
		// elsewhere or diff it against a future invocation. Goes through
		// the generated Encode path so the dry-run output is byte-equal
		// to what would have hit the wire.
		var buf bytes.Buffer
		enc := jx.NewStreamingEncoder(&buf, 1024)
		req.Encode(enc)
		if err := enc.Close(); err != nil {
			return fmt.Errorf("encode dry-run body: %w", err)
		}
		// Re-indent for readability — the streaming encoder writes compact JSON.
		var pretty bytes.Buffer
		if err := json.Indent(&pretty, buf.Bytes(), "", "  "); err != nil {
			return fmt.Errorf("indent dry-run body: %w", err)
		}
		if _, err := fmt.Fprintln(opts.out, pretty.String()); err != nil {
			return err
		}
		return nil
	}

	res, err := client.CreateTask(ctx, req)
	if err != nil {
		return fmt.Errorf("task create: %w", formatTransportError(err))
	}
	task, ok := res.(*moltnetapi.Task)
	if !ok {
		return formatAPIError(res)
	}

	switch opts.outputMode {
	case "id":
		_, err := fmt.Fprintln(opts.out, task.ID.String())
		return err
	case "", "json":
		return printJSONTo(opts.out, task)
	default:
		return fmt.Errorf("--output: unsupported value %q (one of: json, id)", opts.outputMode)
	}
}

// buildCreateTaskReq turns the flag bag into a wire-shaped CreateTaskReq.
// All validation other than client-side JSON-Schema (which needs the
// server's published schema) lives here so the operator gets a fast,
// pre-flight error before any network call.
func buildCreateTaskReq(opts taskCreateOpts) (*moltnetapi.CreateTaskReq, error) {
	if strings.TrimSpace(opts.taskType) == "" {
		return nil, fmt.Errorf("--task-type is required")
	}
	teamID, err := uuid.Parse(opts.teamID)
	if err != nil {
		return nil, fmt.Errorf("invalid --team-id %q: %w", opts.teamID, err)
	}
	diaryID, err := uuid.Parse(opts.diaryID)
	if err != nil {
		return nil, fmt.Errorf("invalid --diary-id %q: %w", opts.diaryID, err)
	}

	inputRaw, err := readInputBlob(opts.inputFile, opts.stdin)
	if err != nil {
		return nil, err
	}
	inputMap, err := decodeInputAsObject(inputRaw)
	if err != nil {
		return nil, err
	}

	req := &moltnetapi.CreateTaskReq{
		TaskType: opts.taskType,
		TeamId:   teamID,
		DiaryId:  diaryID,
		Input:    inputMap,
	}
	if opts.titleSet {
		title := strings.TrimSpace(opts.title)
		if title == "" {
			return nil, fmt.Errorf("--title must not be empty when provided")
		}
		req.Title = moltnetapi.NewOptString(title)
	}

	if opts.correlationIDSet {
		req.CorrelationId, err = parseOptUUIDFlag("correlation-id", opts.correlationID)
		if err != nil {
			return nil, err
		}
	}

	for i, raw := range opts.references {
		var ref moltnetapi.TaskRef
		if err := json.Unmarshal([]byte(raw), &ref); err != nil {
			// 1-based for the user-facing index — repeated flags read more
			// naturally as "1st, 2nd, 3rd" than "0-indexed".
			return nil, fmt.Errorf("invalid --reference #%d JSON: %w", i+1, err)
		}
		req.References = append(req.References, ref)
	}

	for i, raw := range opts.allowedExecutors {
		var ex moltnetapi.ExecutorRef
		if err := json.Unmarshal([]byte(raw), &ex); err != nil {
			return nil, fmt.Errorf("invalid --allowed-executor #%d JSON: %w", i+1, err)
		}
		req.AllowedExecutors = append(req.AllowedExecutors, ex)
	}

	if opts.requiredExecutorTrustLevelSet {
		var lvl moltnetapi.ExecutorTrustLevel
		if err := lvl.UnmarshalText([]byte(opts.requiredExecutorTrustLevel)); err != nil {
			values := lvl.AllValues()
			allowed := make([]string, 0, len(values))
			for _, v := range values {
				allowed = append(allowed, string(v))
			}
			return nil, fmt.Errorf(
				"invalid --required-executor-trust-level %q: must be one of %v",
				opts.requiredExecutorTrustLevel, allowed,
			)
		}
		req.RequiredExecutorTrustLevel = moltnetapi.NewOptExecutorTrustLevel(lvl)
	}

	if opts.dispatchTimeoutSecSet {
		if opts.dispatchTimeoutSec <= 0 {
			return nil, fmt.Errorf("--dispatch-timeout-sec must be > 0, got %d", opts.dispatchTimeoutSec)
		}
		req.DispatchTimeoutSec = moltnetapi.NewOptInt(opts.dispatchTimeoutSec)
	}
	if opts.runningTimeoutSecSet {
		if opts.runningTimeoutSec <= 0 {
			return nil, fmt.Errorf("--running-timeout-sec must be > 0, got %d", opts.runningTimeoutSec)
		}
		req.RunningTimeoutSec = moltnetapi.NewOptInt(opts.runningTimeoutSec)
	}
	if opts.expiresInSecSet {
		if opts.expiresInSec <= 0 {
			return nil, fmt.Errorf("--expires-in-sec must be > 0, got %d", opts.expiresInSec)
		}
		req.ExpiresInSec = moltnetapi.NewOptInt(opts.expiresInSec)
	}
	if opts.maxAttemptsSet {
		if opts.maxAttempts <= 0 {
			return nil, fmt.Errorf("--max-attempts must be > 0, got %d", opts.maxAttempts)
		}
		req.MaxAttempts = moltnetapi.NewOptInt(opts.maxAttempts)
	}

	return req, nil
}

// readInputBlob reads the `input` JSON from a path, stdin ("-" or empty),
// and returns the raw bytes. Empty input is an error — `input` is required
// for every task type.
func readInputBlob(path string, stdin io.Reader) ([]byte, error) {
	var raw []byte
	var err error
	if path == "" || path == "-" {
		raw, err = io.ReadAll(stdin)
		if err != nil {
			return nil, fmt.Errorf("read --input-file from stdin: %w", err)
		}
	} else {
		raw, err = os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read --input-file %q: %w", path, err)
		}
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, fmt.Errorf("--input-file is empty; provide the task type's input JSON")
	}
	return raw, nil
}

// decodeInputAsObject parses the input JSON and wraps it in the
// CreateTaskReqInput shape (map[string]jx.Raw). Rejects non-object inputs
// up-front: every registered task type has an object-shaped input, and a
// stray `[]` or `"string"` would otherwise sail past until the server
// validator rejects it.
func decodeInputAsObject(raw []byte) (moltnetapi.CreateTaskReqInput, error) {
	var doc json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("invalid --input-file JSON: %w", err)
	}
	trimmed := bytes.TrimSpace(doc)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, fmt.Errorf("--input-file must be a JSON object; got %s", inputPreview(trimmed))
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, fmt.Errorf("invalid --input-file JSON object: %w", err)
	}
	out := make(moltnetapi.CreateTaskReqInput, len(fields))
	for k, v := range fields {
		out[k] = jx.Raw(v)
	}
	return out, nil
}

// inputPreview returns a quoted snippet of the user's input for use in shape
// error messages. Truncates at 16 bytes — UTF-8 safety is not a concern here
// because the caller only invokes this after json.Unmarshal succeeded, so the
// first byte is always a JSON structural character ([, ", t, f, n, 0-9 or -).
func inputPreview(b []byte) string {
	if len(b) == 0 {
		return "empty input"
	}
	if len(b) > 16 {
		return fmt.Sprintf("%q", string(b[:16])+"...")
	}
	return fmt.Sprintf("%q", string(b))
}

// validateTaskInputAgainstServer fetches the task type's input schema and
// validates the user's input against it. Errors come back as JSON-Pointer
// paths so the operator can fix the file quickly.
func validateTaskInputAgainstServer(
	ctx context.Context,
	client *moltnetapi.Client,
	taskType string,
	input moltnetapi.CreateTaskReqInput,
) error {
	items, err := fetchTaskSchemas(ctx, client)
	if err != nil {
		return fmt.Errorf("fetch schemas for validation: %w", err)
	}
	var descriptor *moltnetapi.TaskTypeDescriptor
	for i := range items {
		if items[i].TaskType == taskType {
			descriptor = &items[i]
			break
		}
	}
	if descriptor == nil {
		known := make([]string, len(items))
		for i, it := range items {
			known[i] = it.TaskType
		}
		sort.Strings(known)
		return fmt.Errorf("unknown task type %q; known: %v", taskType, known)
	}

	schemaBytes, err := encodeSchemaToBytes(descriptor.InputSchema)
	if err != nil {
		return fmt.Errorf("encode schema for %q: %w", taskType, err)
	}

	compiler := jsonschema.NewCompiler()
	// Resource ID is arbitrary — the schema is supplied by bytes, not URL.
	// Use the schema CID so error messages reference a stable identifier
	// and any future caching layer keys cleanly.
	resourceID := "moltnet:task-schema:" + descriptor.InputSchemaCid
	if err := compiler.AddResource(resourceID, bytes.NewReader(schemaBytes)); err != nil {
		return fmt.Errorf("compile schema for %q: %w", taskType, err)
	}
	schema, err := compiler.Compile(resourceID)
	if err != nil {
		return fmt.Errorf("compile schema for %q: %w", taskType, err)
	}

	inputBytes, err := encodeInputToBytes(input)
	if err != nil {
		return fmt.Errorf("re-encode input for validation: %w", err)
	}
	var asAny any
	if err := json.Unmarshal(inputBytes, &asAny); err != nil {
		return fmt.Errorf("re-decode input for validation: %w", err)
	}

	if err := schema.Validate(asAny); err != nil {
		return formatValidationError(taskType, err)
	}
	return nil
}

// encodeSchemaToBytes turns the descriptor's jx.Raw-typed schema fragments
// back into a single JSON document for the validator. The schema arrived as
// already-validated JSON; we're just re-assembling it.
func encodeSchemaToBytes(in moltnetapi.TaskTypeDescriptorInputSchema) ([]byte, error) {
	out := make(map[string]json.RawMessage, len(in))
	for k, raw := range in {
		out[k] = json.RawMessage(raw)
	}
	return json.Marshal(out)
}

// encodeInputToBytes is the symmetric operation for the user's input —
// reassemble the wire-shaped map[string]jx.Raw back into bytes for the
// validator.
func encodeInputToBytes(in moltnetapi.CreateTaskReqInput) ([]byte, error) {
	out := make(map[string]json.RawMessage, len(in))
	for k, raw := range in {
		out[k] = json.RawMessage(raw)
	}
	return json.Marshal(out)
}

// formatValidationError walks the jsonschema/v5 ValidationError tree and
// flattens it into one human-readable message per failure, each prefixed
// by a JSON Pointer path. The default Error() prints a single line with
// the root path; nested causes have the detail.
func formatValidationError(taskType string, err error) error {
	verr, ok := err.(*jsonschema.ValidationError)
	if !ok {
		return fmt.Errorf("input validation failed for taskType=%s: %w", taskType, err)
	}
	var lines []string
	var walk func(*jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		// Leaves carry the actionable message; intermediate nodes just
		// describe the schema location and are noisy without context.
		if len(e.Causes) == 0 {
			path := e.InstanceLocation
			if path == "" {
				path = "/"
			}
			lines = append(lines, fmt.Sprintf("  - %s: %s", path, e.Message))
			return
		}
		for _, c := range e.Causes {
			walk(c)
		}
	}
	walk(verr)
	sort.Strings(lines)
	return fmt.Errorf(
		"input validation failed for taskType=%s:\n%s",
		taskType, strings.Join(lines, "\n"),
	)
}
