package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"

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

func fetchTaskSchemas(ctx context.Context, client *moltnetapi.Client) ([]moltnetapi.TaskTypeDescriptor, error) {
	res, err := client.ListTaskSchemas(ctx)
	if err != nil {
		return nil, fmt.Errorf("task schemas: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.ListTaskSchemasResponse)
	if !ok {
		return nil, formatAPIError(res)
	}
	return list.Items, nil
}

func schemaAsMap(in moltnetapi.TaskTypeDescriptorInputSchema) map[string]any {
	out := make(map[string]any, len(in))
	for k, raw := range in {
		var v any
		// jx.Raw is already JSON bytes; encoding/json is enough and avoids
		// pulling jx's decoding surface into the CLI. A malformed fragment is
		// a server bug — surface the raw string so the operator can file it.
		if err := json.Unmarshal(raw, &v); err != nil {
			out[k] = string(raw)
			continue
		}
		out[k] = v
	}
	return out
}
