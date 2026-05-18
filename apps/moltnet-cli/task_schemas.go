package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"sync"

	"github.com/go-faster/jx"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

type taskSchemasListOpts struct {
	apiURL   string
	credPath string
	out      io.Writer
}

type taskSchemasGetOpts struct {
	apiURL   string
	credPath string
	taskType string
	out      io.Writer
}

func runTaskSchemasListCmd(opts taskSchemasListOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskSchemasListWithClient(context.Background(), client, opts.out)
}

func runTaskSchemasListWithClient(ctx context.Context, client *moltnetapi.Client, out io.Writer) error {
	items, err := fetchTaskSchemas(ctx, client)
	if err != nil {
		return err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].TaskType < items[j].TaskType })

	// Render as JSON array — matches every other CLI command. Operators who
	// want a tab-aligned view can pipe through `jq -r '.[] | …'`. Avoid
	// shipping a bespoke text renderer that we'd then have to keep aligned
	// with new TaskTypeDescriptor fields.
	type row struct {
		TaskType       string `json:"taskType"`
		OutputKind     string `json:"outputKind"`
		InputSchemaCid string `json:"inputSchemaCid"`
	}
	rows := make([]row, len(items))
	for i, it := range items {
		rows[i] = row{
			TaskType:       it.TaskType,
			OutputKind:     string(it.OutputKind),
			InputSchemaCid: it.InputSchemaCid,
		}
	}
	return printJSONTo(out, rows)
}

func runTaskSchemasGetCmd(opts taskSchemasGetOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskSchemasGetWithClient(context.Background(), client, opts.taskType, opts.out)
}

func runTaskSchemasGetWithClient(ctx context.Context, client *moltnetapi.Client, taskType string, out io.Writer) error {
	if taskType == "" {
		return fmt.Errorf("--task-type is required")
	}
	items, err := fetchTaskSchemas(ctx, client)
	if err != nil {
		return err
	}
	for _, it := range items {
		if it.TaskType == taskType {
			return printJSONTo(out, schemaAsMap(it.InputSchema))
		}
	}
	known := make([]string, len(items))
	for i, it := range items {
		known[i] = it.TaskType
	}
	sort.Strings(known)
	return fmt.Errorf("unknown task type %q; known: %v", taskType, known)
}

// fetchTaskSchemas calls GET /tasks/schemas and unwraps the typed response.
// The result is cached by inputSchemaCid across calls in the same process —
// schema validation (PR 2) needs that same cache for the compiled validator,
// so the fetch and the cache live together here.
func fetchTaskSchemas(ctx context.Context, client *moltnetapi.Client) ([]moltnetapi.TaskTypeDescriptor, error) {
	res, err := client.ListTaskSchemas(ctx)
	if err != nil {
		return nil, fmt.Errorf("task schemas: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.ListTaskSchemasResponse)
	if !ok {
		return nil, formatAPIError(res)
	}
	for i := range list.Items {
		schemaCache.Store(list.Items[i].InputSchemaCid, schemaAsMap(list.Items[i].InputSchema))
	}
	return list.Items, nil
}

// schemaCache is a process-scoped map keyed by inputSchemaCid. Storing the
// JSON-Schema bytes (rather than a compiled validator) keeps this file free
// of the validation lib that lands in PR 2; the validator there will pull
// from the same cache and compile lazily on first use.
var schemaCache sync.Map // key: string (cid), value: map[string]any

func schemaAsMap(in moltnetapi.TaskTypeDescriptorInputSchema) map[string]any {
	out := make(map[string]any, len(in))
	for k, raw := range in {
		out[k] = jxRawToAny(raw)
	}
	return out
}

// jxRawToAny round-trips a jx.Raw into a generic any. The descriptor stores
// schema fragments as opaque JSON tokens; for display and (in PR 2) for
// validator compilation we want plain map/slice/scalar shapes.
func jxRawToAny(r jx.Raw) any {
	var v any
	// jx.Raw is already JSON bytes; encoding/json is enough and avoids
	// pulling jx's decoding surface into the CLI.
	if err := json.Unmarshal(r, &v); err != nil {
		// A malformed schema fragment is a server bug, not a CLI bug —
		// surface the raw string so the operator can file it.
		return string(r)
	}
	return v
}
