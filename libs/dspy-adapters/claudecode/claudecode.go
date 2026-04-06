// Package claudecode provides a dspy-go LLM adapter that executes prompts
// via the Claude Code CLI (claude --print).
package claudecode

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/clierrors"
	dspytypes "github.com/getlarge/themoltnet/libs/dspy-adapters/types"
)

const (
	ProviderName = "claude-code"
	DefaultModel = "claude-sonnet-4-6"
)

// Config holds configuration for the Claude Code CLI adapter.
type Config struct {
	// Model to use (e.g. "claude-sonnet-4-6", "claude-opus-4-6").
	Model string

	// Executable path. Defaults to "claude" (resolved via PATH).
	Executable string

	// MaxBudgetUSD caps spending per call. 0 means no limit (CLI default).
	MaxBudgetUSD float64

	// ExtraArgs are additional CLI flags passed to claude.
	ExtraArgs []string

	// Env overrides for the subprocess. Merged with os.Environ().
	Env map[string]string

	// WorkDir sets the working directory for the subprocess.
	// Defaults to os.TempDir() to avoid loading project config.
	WorkDir string

	// IsolateFromSession disables auto-memory and strips session env vars.
	// Use for eval runs where the agent should not carry state across trials.
	IsolateFromSession bool

	// OnHeartbeat is called periodically during long-running subprocess execution.
	OnHeartbeat dspytypes.HeartbeatFunc
}

// LLM implements core.LLM by spawning the Claude Code CLI.
type LLM struct {
	*core.BaseLLM
	config    Config
	lastUsage *core.TokenInfo
}

// New creates a new Claude Code CLI adapter.
func New(cfg Config) (*LLM, error) {
	if cfg.Model == "" {
		cfg.Model = DefaultModel
	}
	if cfg.Executable == "" {
		cfg.Executable = "claude"
	}

	// Verify the executable exists
	if _, err := exec.LookPath(cfg.Executable); err != nil {
		return nil, fmt.Errorf("claude CLI not found at %q: %w", cfg.Executable, err)
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

// Generate runs a prompt through the Claude Code CLI and returns the response.
func (l *LLM) Generate(ctx context.Context, prompt string, opts ...core.GenerateOption) (*core.LLMResponse, error) {
	args := l.buildArgs(nil)
	return l.run(ctx, prompt, args)
}

// GenerateWithJSON runs a prompt with --json-schema and --output-format json,
// then parses the structured response.
func (l *LLM) GenerateWithJSON(ctx context.Context, prompt string, opts ...core.GenerateOption) (map[string]interface{}, error) {
	// Build a JSON schema from the prompt hints.
	// dspy-go's structured output interceptor injects schema instructions into the prompt.
	// We extract and pass them via --json-schema for native enforcement.
	schema := extractJSONSchemaFromPrompt(prompt)

	var args []string
	if schema != "" {
		args = l.buildJSONArgs([]string{"--json-schema", schema})
	} else {
		args = l.buildJSONArgs(nil)
	}

	resp, err := l.run(ctx, prompt, args)
	if err != nil {
		return nil, err
	}

	return parseJSONResponse(resp.Content)
}

// GenerateWithFunctions is not supported by Claude Code CLI.
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

// buildArgs constructs CLI arguments for claude --print.
func (l *LLM) buildArgs(extra []string) []string {
	return l.buildArgsWithOutputFormat("text", extra)
}

func (l *LLM) buildJSONArgs(extra []string) []string {
	return l.buildArgsWithOutputFormat("json", extra)
}

func (l *LLM) buildArgsWithOutputFormat(outputFormat string, extra []string) []string {
	args := []string{
		"--print",
		"--output-format", outputFormat,
		"--model", l.config.Model,
		"--permission-mode", "bypassPermissions",
		"--no-session-persistence",
		// Isolate from user/project config without disabling OAuth auth
		// (--bare would disable OAuth/keychain, breaking non-API-key setups).
		"--strict-mcp-config",      // zero MCP servers (no --mcp-config arg)
		"--disable-slash-commands", // no skills
		"--no-chrome",              // no browser integration
	}
	if l.config.MaxBudgetUSD > 0 {
		args = append(args, "--max-budget-usd", fmt.Sprintf("%.2f", l.config.MaxBudgetUSD))
	}
	args = append(args, l.config.ExtraArgs...)
	args = append(args, extra...)
	return args
}

// LastUsage returns the token usage from the most recent LLM call.
func (l *LLM) LastUsage() *core.TokenInfo {
	return l.lastUsage
}

// run executes the Claude CLI with the given prompt and args.
func (l *LLM) run(ctx context.Context, prompt string, args []string) (*core.LLMResponse, error) {
	cmd := exec.CommandContext(ctx, l.config.Executable, args...)
	cmd.Dir = l.config.WorkDir
	if cmd.Dir == "" {
		cmd.Dir = os.TempDir()
	}

	// Pass prompt via stdin
	cmd.Stdin = strings.NewReader(prompt)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Build environment
	cmd.Env = l.buildEnv()

	if err := cmd.Run(); err != nil {
		return nil, clierrors.ClassifyCLIError("claude", err, stderr.String(), stdout.String())
	}

	content := strings.TrimSpace(stdout.String())
	if content == "" {
		return nil, fmt.Errorf("claude CLI returned empty response (stderr: %s)", strings.TrimSpace(stderr.String()))
	}

	resp := &core.LLMResponse{
		Content:  content,
		Metadata: map[string]interface{}{"provider": ProviderName},
	}

	// Try to extract usage from the JSON envelope (--output-format json).
	resp.Usage = extractUsageFromEnvelope(content)
	l.lastUsage = resp.Usage

	return resp, nil
}

// extractUsageFromEnvelope tries to parse token usage from a Claude CLI
// JSON envelope. Returns nil if the content isn't a JSON envelope.
func extractUsageFromEnvelope(content string) *core.TokenInfo {
	var envelope struct {
		Usage *struct {
			InputTokens              int `json:"input_tokens"`
			OutputTokens             int `json:"output_tokens"`
			CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
			CacheReadInputTokens     int `json:"cache_read_input_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal([]byte(content), &envelope); err != nil || envelope.Usage == nil {
		return nil
	}
	return &core.TokenInfo{
		PromptTokens:     envelope.Usage.InputTokens,
		CompletionTokens: envelope.Usage.OutputTokens,
		TotalTokens:      envelope.Usage.InputTokens + envelope.Usage.OutputTokens,
	}
}

// buildEnv merges os.Environ with config overrides, stripping sensitive vars.
func (l *LLM) buildEnv() []string {
	env := os.Environ()

	// Strip CLAUDECODE to prevent the subprocess from detecting a nested
	// session. Keep CLAUDE_CODE_OAUTH_TOKEN — it's needed for auth when
	// running outside an interactive Claude Code session.
	filtered := make([]string, 0, len(env))
	stripPrefixes := []string{"CLAUDECODE"}
	for _, e := range env {
		skip := false
		for _, prefix := range stripPrefixes {
			if strings.HasPrefix(e, prefix+"=") || strings.HasPrefix(e, prefix) {
				skip = true
				break
			}
		}
		if l.config.IsolateFromSession && strings.HasPrefix(e, "CLAUDE_CODE_DISABLE_AUTO_MEMORY=") {
			skip = true
		}
		if !skip {
			filtered = append(filtered, e)
		}
	}

	if l.config.IsolateFromSession {
		filtered = append(filtered, "CLAUDE_CODE_DISABLE_AUTO_MEMORY=1")
	}

	// Apply config overrides
	for k, v := range l.config.Env {
		filtered = append(filtered, k+"="+v)
	}

	return filtered
}

// parseJSONResponse extracts structured output from claude CLI JSON responses.
// With --output-format json, the CLI wraps responses in an envelope:
//
//	{ "type": "result", "structured_output": { ... }, ... }
//
// The actual structured data lives in "structured_output".
func parseJSONResponse(content string) (map[string]interface{}, error) {
	var result map[string]interface{}

	if err := json.Unmarshal([]byte(content), &result); err == nil {
		if so, ok := result["structured_output"]; ok {
			if soMap, ok := so.(map[string]interface{}); ok {
				return soMap, nil
			}
		}
		// If there's no envelope (e.g. text output mode), use the top-level map.
		// But filter out known envelope fields to avoid confusion.
		if _, isEnvelope := result["type"]; !isEnvelope {
			return result, nil
		}
	}

	// Try extracting JSON from markdown fences or prose
	extracted := extractJSON(content)
	if extracted != "" {
		if err := json.Unmarshal([]byte(extracted), &result); err == nil {
			return result, nil
		}
	}

	// Truncate content for error message
	preview := content
	if len(preview) > 200 {
		preview = preview[:200] + "..."
	}
	return nil, fmt.Errorf("claude CLI did not return valid JSON.\nResponse:\n%s", preview)
}

// extractJSONSchemaFromPrompt extracts field names from the pseudo-schema that
// dspy-go's structured output interceptor injects into the prompt and builds a
// real JSON Schema for --json-schema enforcement.
//
// dspy-go injects a fenced block like:
//
//	```json
//	{
//	  "reasoning": "<your step-by-step reasoning>",
//	  "coverage": <string>,
//	  "grounding": <string>
//	}
//	```
//
// We parse the quoted keys and emit a JSON Schema with all fields as strings,
// which is enough for the Claude CLI to enforce structured output.
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

	// Extract quoted keys: lines matching `"key": ...`
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

	// Build a minimal JSON Schema
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

// extractJSON tries to find a JSON object in text that may contain markdown fences or prose.
func extractJSON(text string) string {
	// Try markdown fence
	if idx := strings.Index(text, "```json"); idx >= 0 {
		start := idx + len("```json")
		if end := strings.Index(text[start:], "```"); end >= 0 {
			return strings.TrimSpace(text[start : start+end])
		}
	}
	if idx := strings.Index(text, "```"); idx >= 0 {
		start := idx + len("```")
		if end := strings.Index(text[start:], "```"); end >= 0 {
			candidate := strings.TrimSpace(text[start : start+end])
			if len(candidate) > 0 && (candidate[0] == '{' || candidate[0] == '[') {
				return candidate
			}
		}
	}

	// Try finding raw JSON object in prose
	if idx := strings.Index(text, "{"); idx >= 0 {
		depth := 0
		for i := idx; i < len(text); i++ {
			switch text[i] {
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					return text[idx : i+1]
				}
			}
		}
	}

	return ""
}

// streamEvent is the minimal envelope for Claude stream-json events.
type streamEvent struct {
	Type       string  `json:"type"`
	Subtype    string  `json:"subtype,omitempty"`
	Result     string  `json:"result,omitempty"`
	SessionID  string  `json:"session_id,omitempty"`
	DurationMs int64   `json:"duration_ms,omitempty"`
	CostUSD    float64 `json:"total_cost_usd,omitempty"`
	NumTurns   int     `json:"num_turns,omitempty"`
	IsError    bool    `json:"is_error,omitempty"`
	Usage      *struct {
		InputTokens              int `json:"input_tokens"`
		OutputTokens             int `json:"output_tokens"`
		CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
		CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	} `json:"usage,omitempty"`
}

// GenerateWithTrajectory runs a prompt with --output-format stream-json
// and returns the full event trajectory alongside usage metadata.
func (l *LLM) GenerateWithTrajectory(ctx context.Context, prompt string) (*dspytypes.GenerateResponse, error) {
	args := l.buildArgsWithOutputFormat("stream-json", []string{"--verbose"})
	cmd := exec.CommandContext(ctx, l.config.Executable, args...)
	cmd.Dir = l.config.WorkDir
	if cmd.Dir == "" {
		cmd.Dir = os.TempDir()
	}
	cmd.Stdin = strings.NewReader(prompt)
	cmd.Env = l.buildEnv()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	done := make(chan struct{})
	if l.config.OnHeartbeat != nil {
		go runHeartbeat(l.config.OnHeartbeat, done)
	}
	runErr := cmd.Run()
	close(done)

	resp := parseStreamJSON(stdout.Bytes())
	resp.DurationMs = time.Since(start).Milliseconds()

	l.lastUsage = resp.Usage

	if runErr != nil {
		if resp.Content == "" {
			resp.Content = strings.TrimSpace(stderr.String())
		}
		if resp.Content == "" {
			resp.Content = runErr.Error()
		}
		return resp, clierrors.ClassifyCLIError("claude", runErr, stderr.String(), stdout.String())
	}

	return resp, nil
}

// parseStreamJSON extracts trajectory events, final text, and metadata
// from Claude stream-json NDJSON output.
func parseStreamJSON(raw []byte) *dspytypes.GenerateResponse {
	resp := &dspytypes.GenerateResponse{}
	for _, line := range bytes.Split(raw, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var evt streamEvent
		if err := json.Unmarshal(line, &evt); err != nil {
			continue
		}
		switch evt.Type {
		case "assistant":
			copied := make([]byte, len(line))
			copy(copied, line)
			resp.Trajectory = append(resp.Trajectory, json.RawMessage(copied))
		case "result":
			copied := make([]byte, len(line))
			copy(copied, line)
			resp.Trajectory = append(resp.Trajectory, json.RawMessage(copied))
			resp.Content = evt.Result
			resp.SessionID = evt.SessionID
			resp.DurationMs = evt.DurationMs
			resp.CostUSD = evt.CostUSD
			resp.NumTurns = evt.NumTurns
			if evt.Usage != nil {
				resp.Usage = &core.TokenInfo{
					PromptTokens:     evt.Usage.InputTokens,
					CompletionTokens: evt.Usage.OutputTokens,
					TotalTokens:      evt.Usage.InputTokens + evt.Usage.OutputTokens,
				}
				resp.CacheCreationTokens = evt.Usage.CacheCreationInputTokens
				resp.CacheReadTokens = evt.Usage.CacheReadInputTokens
			}
		}
	}
	return resp
}

func runHeartbeat(fn dspytypes.HeartbeatFunc, done <-chan struct{}) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	start := time.Now()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			fn(time.Since(start))
		}
	}
}

// Register adds the claude-code provider to the dspy-go registry.
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
