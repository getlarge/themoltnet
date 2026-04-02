package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// McpServerConfig describes a single MCP server entry.
type McpServerConfig struct {
	Type    string            `json:"type"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
}

// McpConfig is the .mcp.json file structure.
type McpConfig struct {
	McpServers map[string]McpServerConfig `json:"mcpServers"`
}

// BuildMcpConfig creates the MCP config for the given MCP URL and credentials.
func BuildMcpConfig(mcpURL string, clientID string, clientSecret string) McpConfig {
	return McpConfig{
		McpServers: map[string]McpServerConfig{
			"moltnet": {
				Type: "http",
				URL:  mcpURL,
				Headers: map[string]string{
					"X-Client-Id":     clientID,
					"X-Client-Secret": clientSecret,
				},
			},
		},
	}
}

// WriteMcpConfig writes or merges .mcp.json in the given directory.
func WriteMcpConfig(mcpConfig McpConfig, dir string) (string, error) {
	if dir == "" {
		var err error
		dir, err = os.Getwd()
		if err != nil {
			return "", fmt.Errorf("get cwd: %w", err)
		}
	}

	filePath := filepath.Join(dir, ".mcp.json")

	// Try to read existing file
	existing := make(map[string]json.RawMessage)
	data, err := os.ReadFile(filePath)
	if err == nil {
		if jsonErr := json.Unmarshal(data, &existing); jsonErr != nil {
			fmt.Fprintf(os.Stderr, "warning: %s contains invalid JSON, overwriting\n", filePath)
		}
	}

	// Merge mcpServers
	existingServers := make(map[string]json.RawMessage)
	if raw, ok := existing["mcpServers"]; ok {
		_ = json.Unmarshal(raw, &existingServers)
	}

	for name, server := range mcpConfig.McpServers {
		serverJSON, err := json.Marshal(server)
		if err != nil {
			return "", fmt.Errorf("marshal server %s: %w", name, err)
		}
		existingServers[name] = serverJSON
	}

	mergedServers, err := json.Marshal(existingServers)
	if err != nil {
		return "", fmt.Errorf("marshal servers: %w", err)
	}
	existing["mcpServers"] = mergedServers

	output, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal config: %w", err)
	}
	output = append(output, '\n')

	if err := os.WriteFile(filePath, output, 0o644); err != nil {
		return "", fmt.Errorf("write config: %w", err)
	}

	return filePath, nil
}
