// Package codex provides a dspy-go LLM adapter that executes prompts
// via the Codex CLI (codex exec).
package codex

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/clierrors"
)

const (
	ProviderName = "codex"
	DefaultModel = "gpt-5.3-codex"
)

// Config holds configuration for the Codex CLI adapter.
type Config struct {
	// Model to use (e.g. "o3", "o4-mini", "gpt-4.1").
	Model string

	// Executable path. Defaults to "codex" (resolved via PATH).
	Executable string

	// SandboxMode for codex exec. Defaults to "read-only".
	SandboxMode string

	// ExtraArgs are additional CLI flags passed to codex exec.
	ExtraArgs []string

	// Env overrides for the subprocess. Merged with os.Environ().
	Env map[string]string
}

// LLM implements core.LLM by spawning the Codex CLI.
type LLM struct {
	*core.BaseLLM
	config Config
}

// New creates a new Codex CLI adapter.
func New(cfg Config) (*LLM, error) {
	if cfg.Model == "" {
		cfg.Model = DefaultModel
	}
	if cfg.Executable == "" {
		cfg.Executable = "codex"
	}
	if cfg.SandboxMode == "" {
		cfg.SandboxMode = "read-only"
	}

	if _, err := exec.LookPath(cfg.Executable); err != nil {
		return nil, fmt.Errorf("codex CLI not found at %q: %w", cfg.Executable, err)
	}

	caps := []core.Capability{
		core.CapabilityCompletion,
		core.CapabilityChat,
		core.CapabilityJSON,
	}

	return &LLM{
		BaseLLM: core.NewBaseLLM(ProviderName, core.ModelID(cfg.Model), caps, nil),
		config:  cfg,
	}, nil
}

// Generate runs a prompt through codex exec and returns the response.
func (l *LLM) Generate(ctx context.Context, prompt string, opts ...core.GenerateOption) (*core.LLMResponse, error) {
	args := l.buildArgs(nil)
	return l.run(ctx, prompt, args)
}

// GenerateWithJSON runs a prompt with --output-schema and --json,
// then extracts the structured response from JSONL events.
func (l *LLM) GenerateWithJSON(ctx context.Context, prompt string, opts ...core.GenerateOption) (map[string]interface{}, error) {
	schema := extractJSONSchemaFromPrompt(prompt)

	schemaFile, err := writeSchemaToTempFile(schema)
	if err != nil {
		return nil, err
	}
	defer os.Remove(schemaFile)

	args := l.buildArgs([]string{"--json", "--output-schema", schemaFile})

	resp, err := l.run(ctx, prompt, args)
	if err != nil {
		return nil, err
	}

	result, err := extractStructuredOutputFromJSONL(resp.Content)
	if err != nil {
		return nil, fmt.Errorf("codex CLI structured output extraction failed: %w\nRaw output:\n%s", err, resp.Content)
	}

	return result, nil
}

// GenerateWithFunctions is not supported by Codex CLI.
func (l *LLM) GenerateWithFunctions(ctx context.Context, prompt string, functions []map[string]interface{}, opts ...core.GenerateOption) (map[string]interface{}, error) {
	return nil, fmt.Errorf("function calling not supported by %s", ProviderName)
}

// StreamGenerate fakes streaming by running a single generation.
func (l *LLM) StreamGenerate(ctx context.Context, prompt string, opts ...core.GenerateOption) (*core.StreamResponse, error) {
	chunkChan := make(chan core.StreamChunk, 2)

	go func() {
		defer close(chunkChan)
		resp, err := l.Generate(ctx, prompt, opts...)
		if err != nil {
			chunkChan <- core.StreamChunk{Error: err}
			return
		}
		chunkChan <- core.StreamChunk{Content: resp.Content}
		chunkChan <- core.StreamChunk{Done: true, Usage: resp.Usage}
	}()

	return &core.StreamResponse{ChunkChannel: chunkChan}, nil
}

// CreateEmbedding is not supported.
func (l *LLM) CreateEmbedding(ctx context.Context, input string, opts ...core.EmbeddingOption) (*core.EmbeddingResult, error) {
	return nil, fmt.Errorf("embeddings not supported by %s", ProviderName)
}

// CreateEmbeddings is not supported.
func (l *LLM) CreateEmbeddings(ctx context.Context, inputs []string, opts ...core.EmbeddingOption) (*core.BatchEmbeddingResult, error) {
	return nil, fmt.Errorf("embeddings not supported by %s", ProviderName)
}

// buildArgs constructs CLI arguments for codex exec.
func (l *LLM) buildArgs(extra []string) []string {
	args := []string{
		"exec",
		"--model", l.config.Model,
		"--sandbox", l.config.SandboxMode,
		"--ephemeral",
		"--skip-git-repo-check",
		// Isolate from user/project config: disable MCP servers, plugins,
		// and set cwd to /tmp so project-level AGENTS.md and rules are not loaded.
		"-c", "mcp_servers={}",
		"-c", "plugins={}",
		"--cd", os.TempDir(),
	}
	args = append(args, l.config.ExtraArgs...)
	args = append(args, extra...)
	return args
}

// run executes the Codex CLI with the given prompt and args.
func (l *LLM) run(ctx context.Context, prompt string, args []string) (*core.LLMResponse, error) {
	cmd := exec.CommandContext(ctx, l.config.Executable, args...)

	cmd.Stdin = strings.NewReader(prompt)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	cmd.Env = l.buildEnv()

	if err := cmd.Run(); err != nil {
		// Codex outputs errors as JSONL on stdout even on failure.
		// Try to extract a meaningful error from the JSONL before falling
		// back to the generic classifier.
		if jsonlErr := extractErrorFromJSONL(stdout.String()); jsonlErr != "" {
			return nil, clierrors.ClassifyCLIError("codex", err, jsonlErr, "")
		}
		return nil, clierrors.ClassifyCLIError("codex", err, stderr.String(), stdout.String())
	}

	content := strings.TrimSpace(stdout.String())
	if content == "" {
		return nil, fmt.Errorf("codex CLI returned empty response (stderr: %s)", strings.TrimSpace(stderr.String()))
	}

	return &core.LLMResponse{
		Content:  content,
		Metadata: map[string]interface{}{"provider": ProviderName},
	}, nil
}

// buildEnv merges os.Environ with config overrides.
func (l *LLM) buildEnv() []string {
	env := os.Environ()

	for k, v := range l.config.Env {
		env = append(env, k+"="+v)
	}

	return env
}

// writeSchemaToTempFile writes a JSON schema string to a temp file for --output-schema.
func writeSchemaToTempFile(schema string) (string, error) {
	hasExtractedSchema := strings.TrimSpace(schema) != ""
	if !hasExtractedSchema {
		// No schema extracted from prompt — use a permissive fallback that
		// allows any fields. We keep additionalProperties: true here so
		// Codex doesn't reject valid output.
		schema = `{"type":"object","additionalProperties":true}`
	}

	// Codex requires additionalProperties: false at the top level for
	// extracted schemas. Preserve the permissive fallback when no schema
	// could be extracted.
	if hasExtractedSchema {
		var schemaMap map[string]interface{}
		if err := json.Unmarshal([]byte(schema), &schemaMap); err == nil {
			schemaMap["additionalProperties"] = false
			if patched, err := json.Marshal(schemaMap); err == nil {
				schema = string(patched)
			}
		}
	}

	f, err := os.CreateTemp("", "codex-schema-*.json")
	if err != nil {
		return "", fmt.Errorf("create schema temp file: %w", err)
	}
	if _, err := f.WriteString(schema); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", fmt.Errorf("write schema temp file: %w", err)
	}
	f.Close()
	return f.Name(), nil
}

// jsonlEvent represents a single line in the codex exec --json output.
type jsonlEvent struct {
	Type string `json:"type"`
	Item *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"item,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// extractErrorFromJSONL scans JSONL output for error/turn.failed events and
// returns a human-readable error string, or "" if no errors found.
func extractErrorFromJSONL(output string) string {
	var errors []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var event jsonlEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		switch event.Type {
		case "error":
			if event.Message != "" {
				errors = append(errors, event.Message)
			}
		case "turn.failed":
			if event.Error != nil && event.Error.Message != "" {
				errors = append(errors, event.Error.Message)
			}
		}
	}
	if len(errors) == 0 {
		return ""
	}
	// Return the last error (most specific), skip "Reconnecting..." noise
	for i := len(errors) - 1; i >= 0; i-- {
		if !strings.HasPrefix(errors[i], "Reconnecting...") {
			return errors[i]
		}
	}
	return errors[len(errors)-1]
}

// extractStructuredOutputFromJSONL parses the JSONL output from codex exec --json
// and extracts the structured response from the last item.completed agent_message.
func extractStructuredOutputFromJSONL(output string) (map[string]interface{}, error) {
	var lastAgentText string
	var lastError string

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var event jsonlEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		switch event.Type {
		case "item.completed":
			if event.Item != nil && event.Item.Type == "agent_message" && event.Item.Text != "" {
				lastAgentText = event.Item.Text
			}
		case "error":
			if event.Message != "" {
				lastError = event.Message
			} else if event.Error != nil {
				lastError = event.Error.Message
			}
		case "turn.failed":
			if event.Error != nil {
				lastError = event.Error.Message
			}
		}
	}

	if lastAgentText == "" {
		if lastError != "" {
			return nil, fmt.Errorf("codex returned error: %s", lastError)
		}
		return nil, fmt.Errorf("no agent_message found in codex output")
	}

	var result map[string]interface{}
	if err := json.Unmarshal([]byte(lastAgentText), &result); err != nil {
		return nil, fmt.Errorf("agent_message is not valid JSON: %w\nText: %s", err, lastAgentText)
	}

	return result, nil
}

// extractJSONSchemaFromPrompt extracts field names from the pseudo-schema that
// dspy-go's structured output interceptor injects into the prompt and builds a
// real JSON Schema for --output-schema enforcement.
//
// This is the same logic as the claudecode adapter — dspy-go injects a fenced
// block with quoted keys that we convert to a proper JSON Schema.
func extractJSONSchemaFromPrompt(prompt string) string {
	const marker = "```json"
	idx := strings.Index(prompt, marker)
	if idx < 0 {
		return ""
	}
	start := idx + len(marker)
	end := strings.Index(prompt[start:], "```")
	if end < 0 {
		return ""
	}
	block := prompt[start : start+end]

	var fields []string
	for _, line := range strings.Split(block, "\n") {
		line = strings.TrimSpace(line)
		if len(line) == 0 || line[0] != '"' {
			continue
		}
		closing := strings.Index(line[1:], `"`)
		if closing < 0 {
			continue
		}
		key := line[1 : 1+closing]
		fields = append(fields, key)
	}

	if len(fields) == 0 {
		return ""
	}

	props := make([]string, 0, len(fields))
	for _, f := range fields {
		props = append(props, fmt.Sprintf(`%q:{"type":"string"}`, f))
	}

	return fmt.Sprintf(
		`{"type":"object","properties":{%s},"required":[%s],"additionalProperties":false}`,
		strings.Join(props, ","),
		joinQuoted(fields),
	)
}

func joinQuoted(ss []string) string {
	quoted := make([]string, len(ss))
	for i, s := range ss {
		quoted[i] = fmt.Sprintf("%q", s)
	}
	return strings.Join(quoted, ",")
}

// Register adds the codex provider to the dspy-go registry.
func Register() {
	core.RegisterProviderFactory(ProviderName, func(
		ctx context.Context,
		config core.ProviderConfig,
		modelID core.ModelID,
	) (core.LLM, error) {
		return New(Config{
			Model: string(modelID),
		})
	})
}
