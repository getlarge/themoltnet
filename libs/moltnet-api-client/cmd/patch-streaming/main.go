// Command patch-streaming preserves streaming for the NDJSON commit endpoint.
// ogen currently buffers io.Reader responses and closes their body before return.
package main

import (
	"fmt"
	"os"
	"strings"
)

type replacement struct{ old, new string }

func patch(path, start, end string, edits ...replacement) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	text := string(data)
	begin := strings.Index(text, start)
	if begin < 0 {
		return fmt.Errorf("%s: missing start marker", path)
	}
	finish := strings.Index(text[begin:], end)
	if finish < 0 {
		return fmt.Errorf("%s: missing end marker", path)
	}
	finish += begin
	section := text[begin:finish]
	for _, edit := range edits {
		if strings.Count(section, edit.old) != 1 {
			return fmt.Errorf("%s: expected one generated streaming pattern", path)
		}
		section = strings.Replace(section, edit.old, edit.new, 1)
	}
	return os.WriteFile(path, []byte(text[:begin]+section+text[finish:]), 0o644)
}

func main() {
	if err := patch("oas_response_decoders_gen.go",
		"func decodeListRuntimeStoreCommitsResponse(",
		"func decodeListSigningCredentialsResponse(",
		replacement{
			old: "\t\t\treader := resp.Body\n\t\t\tb, err := io.ReadAll(reader)\n\t\t\tif err != nil {\n\t\t\t\treturn res, err\n\t\t\t}\n\n\t\t\tresponse := ListRuntimeStoreCommitsOK{Data: bytes.NewReader(b)}",
			new: "\t\t\tresponse := ListRuntimeStoreCommitsOK{Data: resp.Body}",
		}); err != nil {
		panic(err)
	}
	if err := patch("oas_client_gen.go",
		"func (c *Client) sendListRuntimeStoreCommits(",
		"// ListSigningCredentials invokes",
		replacement{
			old: "\tstartTime := time.Now()\n\tdefer func() {\n\t\t// Use floating point division",
			new: "\tstartTime := time.Now()\n\tstreamedResponse := false\n\tdefer func() {\n\t\tif streamedResponse {\n\t\t\treturn // Record the duration when the stream finishes.\n\t\t}\n\t\t// Use floating point division",
		},
		replacement{
			old: "\tdefer func() {\n\t\tif err != nil {\n\t\t\tspan.RecordError(err)",
			new: "\tdefer func() {\n\t\tif streamedResponse {\n\t\t\treturn // End the span when the stream finishes.\n\t\t}\n\t\tif err != nil {\n\t\t\tspan.RecordError(err)",
		},
		replacement{
			old: "\tbody := resp.Body\n\tdefer func() {\n\t\t// Drain the body",
			new: "\tbody := resp.Body\n\tretainBody := false\n\tdefer func() {\n\t\tif retainBody {\n\t\t\treturn // The caller closes the streamed response.\n\t\t}\n\t\t// Drain the body",
		},
		replacement{
			old: "\treturn result, nil\n}",
			new: "\tif stream, ok := result.(*ListRuntimeStoreCommitsOK); ok {\n\t\tstream.Data = &commitResponseStream{ReadCloser: body, onFinish: func(readErr error) {\n\t\t\tif readErr != nil {\n\t\t\t\tspan.RecordError(readErr)\n\t\t\t\tspan.SetStatus(codes.Error, \"ReadResponse\")\n\t\t\t\tc.errors.Add(ctx, 1, metric.WithAttributes(otelAttrs...))\n\t\t\t}\n\t\t\telapsedDuration := time.Since(startTime)\n\t\t\tc.duration.Record(ctx, float64(elapsedDuration)/float64(time.Millisecond), metric.WithAttributes(otelAttrs...))\n\t\t\tspan.End()\n\t\t}}\n\t\tretainBody = true\n\t\tstreamedResponse = true\n\t}\n\treturn result, nil\n}",
		}); err != nil {
		panic(err)
	}
}
