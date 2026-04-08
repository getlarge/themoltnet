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

	"path/filepath"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/clierrors"
	dspytypes "github.com/getlarge/themoltnet/libs/dspy-adapters/types"
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

	// WorkDir sets the working directory for the subprocess.
	// Defaults to os.TempDir() to avoid loading project config.
	WorkDir string

	// IsolateHome creates a temp CODEX_HOME with auth bridged from the
	// user's real home. Prevents loading user/project MCP servers and plugins.
	IsolateHome bool

	// OnHeartbeat is called periodically during long-running subprocess execution.
	OnHeartbeat dspytypes.HeartbeatFunc
}

// LLM implements core.LLM by spawning the Codex CLI.
//
// LLM is NOT safe for concurrent use — lastUsage and trajectories are
// shared mutable state on the instance. In MoltNet usage (eval solver,
// judge modules) each goroutine constructs its own LLM via codex.New,
// so there's no sharing. Do not change that assumption without adding
// synchronization.
type LLM struct {
	*core.BaseLLM
	config       Config
	lastUsage    *core.TokenInfo
	trajectories []*dspytypes.GenerateResponse
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
//
// Internally this uses codex exec --json so the full JSONL event stream
// is captured on every call. Callers that want the rich trajectory
// (used by eval artifacts) can read it via LastTrajectory(). Callers
// that only want the final text use the returned *core.LLMResponse as
// normal — the switch is transparent to dspy-go's Predict/ChainOfThought
// modules.
func (l *LLM) Generate(ctx context.Context, prompt string, opts ...core.GenerateOption) (*core.LLMResponse, error) {
	traj, err := l.runStream(ctx, prompt)
	if err != nil {
		if traj == nil {
			return nil, err
		}
		return &core.LLMResponse{
			Content:  traj.Content,
			Usage:    traj.Usage,
			Metadata: map[string]interface{}{"provider": ProviderName},
		}, err
	}
	return &core.LLMResponse{
		Content:  traj.Content,
		Usage:    traj.Usage,
		Metadata: map[string]interface{}{"provider": ProviderName},
	}, nil
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

// LastUsage returns the token usage from the most recent LLM call.
func (l *LLM) LastUsage() *core.TokenInfo {
	return l.lastUsage
}

// buildArgs constructs CLI arguments for codex exec.
func (l *LLM) buildArgs(extra []string) []string {
	args := []string{
		"exec",
		"--model", l.config.Model,
		"--sandbox", l.config.SandboxMode,
		"--ephemeral",
		"--skip-git-repo-check",
		"-c", "mcp_servers={}",
		"-c", "plugins={}",
	}
	// When WorkDir is set the caller controls cwd via cmd.Dir;
	// otherwise fall back to /tmp to avoid loading project config.
	if l.config.WorkDir == "" {
		args = append(args, "--cd", os.TempDir())
	}
	args = append(args, l.config.ExtraArgs...)
	args = append(args, extra...)
	return args
}

// run executes the Codex CLI with the given prompt and args.
func (l *LLM) run(ctx context.Context, prompt string, args []string) (*core.LLMResponse, error) {
	cmd := exec.CommandContext(ctx, l.config.Executable, args...)
	if l.config.WorkDir != "" {
		cmd.Dir = l.config.WorkDir
	}

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

	resp := &core.LLMResponse{
		Content:  content,
		Metadata: map[string]interface{}{"provider": ProviderName},
	}

	// Extract usage from JSONL turn.completed events (when --json is used).
	resp.Usage = extractUsageFromJSONL(content)
	l.lastUsage = resp.Usage

	return resp, nil
}

// extractUsageFromJSONL aggregates token usage from turn.completed events.
func extractUsageFromJSONL(output string) *core.TokenInfo {
	var totalInput, totalOutput int
	found := false
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var evt struct {
			Type  string `json:"type"`
			Usage *struct {
				InputTokens       int `json:"input_tokens"`
				CachedInputTokens int `json:"cached_input_tokens"`
				OutputTokens      int `json:"output_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			continue
		}
		if evt.Type == "turn.completed" && evt.Usage != nil {
			totalInput += evt.Usage.InputTokens
			totalOutput += evt.Usage.OutputTokens
			found = true
		}
	}
	if !found {
		return nil
	}
	return &core.TokenInfo{
		PromptTokens:     totalInput,
		CompletionTokens: totalOutput,
		TotalTokens:      totalInput + totalOutput,
	}
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

// --- Eval-aware methods ---

// codexTrajectoryEvent is the full envelope for Codex --json JSONL output.
type codexTrajectoryEvent struct {
	Type     string `json:"type"`
	ThreadID string `json:"thread_id,omitempty"`
	Item     *struct {
		Type             string `json:"type"`
		Text             string `json:"text"`
		Command          string `json:"command,omitempty"`
		AggregatedOutput string `json:"aggregated_output,omitempty"`
		ExitCode         *int   `json:"exit_code,omitempty"`
	} `json:"item,omitempty"`
	Usage *struct {
		InputTokens       int `json:"input_tokens"`
		CachedInputTokens int `json:"cached_input_tokens"`
		OutputTokens      int `json:"output_tokens"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// LastTrajectory returns the rich trajectory captured from the most
// recent Generate call (or nil if Generate has not been called yet).
// This is the side-channel used by eval artifacts to persist the full
// CLI event stream, session ID, cost, and turn count.
func (l *LLM) LastTrajectory() *dspytypes.GenerateResponse {
	if len(l.trajectories) == 0 {
		return nil
	}
	return l.trajectories[len(l.trajectories)-1]
}

// Trajectories returns all trajectories captured from Generate calls
// in call order. Required for multi-step dspy-go modules like ReAct
// where each iteration issues a fresh Generate; eval code aggregates
// cost / turn count / events across iterations. Returns an empty slice
// before any Generate call completes. The returned slice references
// the adapter's internal buffer — do not mutate.
func (l *LLM) Trajectories() []*dspytypes.GenerateResponse {
	return l.trajectories
}

// runStream executes codex exec with --json --full-auto, parses the
// full JSONL event trajectory, and stashes it on the LLM instance so
// Generate can return a *core.LLMResponse while callers that need the
// rich metadata can still read it via LastTrajectory().
func (l *LLM) runStream(ctx context.Context, prompt string) (*dspytypes.GenerateResponse, error) {
	codexHome, cleanup, err := l.setupIsolation()
	if err != nil {
		return nil, err
	}
	if cleanup != nil {
		defer cleanup()
	}

	args := []string{
		"exec",
		"--model", l.config.Model,
		"--full-auto",
		"--json",
		"--skip-git-repo-check",
		"--ephemeral",
		"-c", "mcp_servers={}",
		"-c", "plugins={}",
	}
	args = append(args, l.config.ExtraArgs...)

	cmd := exec.CommandContext(ctx, l.config.Executable, args...)
	cmd.Dir = l.config.WorkDir
	if cmd.Dir == "" {
		cmd.Dir = os.TempDir()
	}
	cmd.Stdin = strings.NewReader(prompt)
	env := l.buildEnv()
	if codexHome != "" {
		// Inject isolated CODEX_HOME without mutating config.
		env = replaceOrAppendEnv(env, "CODEX_HOME", codexHome)
	}
	cmd.Env = env

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	done := make(chan struct{})
	if l.config.OnHeartbeat != nil {
		go dspytypes.RunHeartbeat(l.config.OnHeartbeat, done)
	}
	runErr := cmd.Run()
	close(done)

	resp := parseCodexTrajectory(stdout.Bytes())
	resp.DurationMs = time.Since(start).Milliseconds()

	l.lastUsage = resp.Usage
	l.trajectories = append(l.trajectories, resp)

	if runErr != nil {
		if resp.Content == "" {
			resp.Content = strings.TrimSpace(stderr.String())
		}
		if resp.Content == "" {
			resp.Content = runErr.Error()
		}
		return resp, clierrors.ClassifyCLIError("codex", runErr, stderr.String(), stdout.String())
	}

	return resp, nil
}

// parseCodexTrajectory extracts trajectory events, final text, session ID,
// turn count, and usage from Codex --json JSONL output.
func parseCodexTrajectory(raw []byte) *dspytypes.GenerateResponse {
	resp := &dspytypes.GenerateResponse{}
	var lastAgentText string
	var lastError string
	var totalInput, totalCached, totalOutput int

	for _, line := range bytes.Split(raw, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var evt codexTrajectoryEvent
		if err := json.Unmarshal(line, &evt); err != nil {
			continue
		}
		switch evt.Type {
		case "thread.started":
			if evt.ThreadID != "" {
				resp.SessionID = evt.ThreadID
			}
			appendEvent(&resp.Trajectory, line)
		case "item.started":
			appendEvent(&resp.Trajectory, line)
		case "item.completed":
			appendEvent(&resp.Trajectory, line)
			if evt.Item != nil && evt.Item.Type == "agent_message" {
				if evt.Item.Text != "" {
					lastAgentText = evt.Item.Text
				}
			}
		case "turn.completed":
			resp.NumTurns++
			appendEvent(&resp.Trajectory, line)
			if evt.Usage != nil {
				totalInput += evt.Usage.InputTokens
				totalCached += evt.Usage.CachedInputTokens
				totalOutput += evt.Usage.OutputTokens
			}
		case "error":
			if evt.Message != "" {
				lastError = evt.Message
			} else if evt.Error != nil {
				lastError = evt.Error.Message
			}
		case "turn.failed":
			if evt.Error != nil && evt.Error.Message != "" {
				lastError = evt.Error.Message
			}
		}
	}

	if lastAgentText != "" {
		resp.Content = lastAgentText
	} else if lastError != "" {
		resp.Content = lastError
	}

	if totalInput > 0 || totalOutput > 0 {
		resp.CacheReadTokens = totalCached
		resp.Usage = &core.TokenInfo{
			PromptTokens:     totalInput,
			CompletionTokens: totalOutput,
			TotalTokens:      totalInput + totalOutput,
		}
	}

	return resp
}

func appendEvent(trajectory *[]json.RawMessage, line []byte) {
	copied := make([]byte, len(line))
	copy(copied, line)
	*trajectory = append(*trajectory, json.RawMessage(copied))
}

// setupIsolation creates a temp CODEX_HOME when IsolateHome is set.
// Returns the isolated home path (empty if not isolated) and a cleanup function.
func (l *LLM) setupIsolation() (string, func(), error) {
	if !l.config.IsolateHome {
		return "", nil, nil
	}

	codexHome, err := os.MkdirTemp("", "dspy-codex-home-*")
	if err != nil {
		return "", nil, fmt.Errorf("create codex home: %w", err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"),
		[]byte("cli_auth_credentials_store = \"file\"\n"), 0o644); err != nil {
		os.RemoveAll(codexHome)
		return "", nil, fmt.Errorf("write codex config: %w", err)
	}
	if err := BridgeCodexAuth(codexHome); err != nil {
		os.RemoveAll(codexHome)
		return "", nil, fmt.Errorf("bridge codex auth: %w", err)
	}

	return codexHome, func() { os.RemoveAll(codexHome) }, nil
}

// BridgeCodexAuth copies auth credentials into an isolated CODEX_HOME.
// It tries these sources in order:
//  1. MOLTNET_CODEX_AUTH_CACHE_PATH (explicit override)
//  2. Original CODEX_HOME/auth.json (from user's real home)
//  3. ~/.codex/auth.json (default location)
//  4. OPENAI_API_KEY env var → synthetic auth.json
//
// If none are available, it returns nil (Codex will fail with 401 at runtime).
func BridgeCodexAuth(isolatedHome string) error {
	candidates := []string{}
	if p := os.Getenv("MOLTNET_CODEX_AUTH_CACHE_PATH"); p != "" {
		candidates = append(candidates, p)
	}
	if p := os.Getenv("CODEX_HOME"); p != "" {
		candidates = append(candidates, filepath.Join(p, "auth.json"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, ".codex", "auth.json"))
	}

	for _, src := range candidates {
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		return os.WriteFile(filepath.Join(isolatedHome, "auth.json"), data, 0o600)
	}

	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		payload := fmt.Sprintf(`{"OPENAI_API_KEY":%q}`, key)
		return os.WriteFile(filepath.Join(isolatedHome, "auth.json"), []byte(payload), 0o600)
	}

	fmt.Fprintf(os.Stderr, "warning: no Codex auth credentials found — Codex will likely fail with 401. "+
		"Set OPENAI_API_KEY, run 'codex auth login', or set MOLTNET_CODEX_AUTH_CACHE_PATH.\n")
	return nil
}

func replaceOrAppendEnv(env []string, key, value string) []string {
	prefix := key + "="
	result := make([]string, 0, len(env)+1)
	for _, e := range env {
		if !strings.HasPrefix(e, prefix) {
			result = append(result, e)
		}
	}
	return append(result, prefix+value)
}
