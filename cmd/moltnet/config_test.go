package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteMcpConfig_CreateNew(t *testing.T) {
	dir := t.TempDir()
	config := BuildMcpConfig("https://api.themolt.net")

	path, err := WriteMcpConfig(config, dir)
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	expected := filepath.Join(dir, ".mcp.json")
	if path != expected {
		t.Errorf("path: got %s, want %s", path, expected)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var result map[string]map[string]McpServerConfig
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	moltnet, ok := result["mcpServers"]["moltnet"]
	if !ok {
		t.Fatal("missing moltnet server")
	}
	if moltnet.URL != "https://api.themolt.net/mcp" {
		t.Errorf("url: got %s", moltnet.URL)
	}
	if moltnet.Transport != "sse" {
		t.Errorf("transport: got %s", moltnet.Transport)
	}
}

func TestWriteMcpConfig_MergeExisting(t *testing.T) {
	dir := t.TempDir()
	existing := `{
  "mcpServers": {
    "other": {"url": "http://other.com/mcp", "transport": "sse"}
  }
}
`
	os.WriteFile(filepath.Join(dir, ".mcp.json"), []byte(existing), 0o644)

	config := BuildMcpConfig("https://api.themolt.net")
	_, err := WriteMcpConfig(config, dir)
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, ".mcp.json"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var result map[string]map[string]McpServerConfig
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if _, ok := result["mcpServers"]["other"]; !ok {
		t.Error("existing server was removed")
	}
	if _, ok := result["mcpServers"]["moltnet"]; !ok {
		t.Error("moltnet server was not added")
	}
}

func TestWriteMcpConfig_OverwriteMoltnet(t *testing.T) {
	dir := t.TempDir()
	existing := `{
  "mcpServers": {
    "moltnet": {"url": "http://old.com/mcp", "transport": "sse"}
  }
}
`
	os.WriteFile(filepath.Join(dir, ".mcp.json"), []byte(existing), 0o644)

	config := BuildMcpConfig("https://api.themolt.net")
	_, err := WriteMcpConfig(config, dir)
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, ".mcp.json"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var result map[string]map[string]McpServerConfig
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if result["mcpServers"]["moltnet"].URL != "https://api.themolt.net/mcp" {
		t.Errorf("moltnet url not updated: got %s", result["mcpServers"]["moltnet"].URL)
	}
}

func TestBuildMcpConfig(t *testing.T) {
	config := BuildMcpConfig("https://api.themolt.net")
	if config.McpServers["moltnet"].URL != "https://api.themolt.net/mcp" {
		t.Errorf("url: got %s", config.McpServers["moltnet"].URL)
	}
	if config.McpServers["moltnet"].Transport != "sse" {
		t.Errorf("transport: got %s", config.McpServers["moltnet"].Transport)
	}
}
