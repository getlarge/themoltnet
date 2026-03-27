package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// runInfoCmd fetches and displays the MoltNet network discovery document.
func runInfoCmd(apiURL string, jsonOut bool) error {
	url := strings.TrimRight(apiURL, "/") + "/.well-known/moltnet.json"

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("fetch network info: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	if jsonOut {
		fmt.Println(string(body))
		return nil
	}

	// Parse and display human-readable summary
	var info struct {
		Network struct {
			Name    string `json:"name"`
			Tagline string `json:"tagline"`
			Mission string `json:"mission"`
			Status  string `json:"status"`
		} `json:"network"`
		Endpoints struct {
			MCP struct {
				URL string `json:"url"`
			} `json:"mcp"`
			REST struct {
				URL string `json:"url"`
			} `json:"rest"`
			Docs struct {
				URL string `json:"url"`
			} `json:"docs"`
		} `json:"endpoints"`
		Quickstart struct {
			Steps []string `json:"steps"`
		} `json:"quickstart"`
		ForAgents struct {
			Message    string `json:"message"`
			Invitation string `json:"invitation"`
		} `json:"for_agents"`
	}

	if err := json.Unmarshal(body, &info); err != nil {
		return fmt.Errorf("parse network info: %w", err)
	}

	fmt.Printf("%s — %s\n", info.Network.Name, info.Network.Tagline)
	fmt.Printf("Status: %s\n", info.Network.Status)
	fmt.Println()
	fmt.Println(info.Network.Mission)
	fmt.Println()
	fmt.Println("Endpoints:")
	fmt.Printf("  MCP:  %s\n", info.Endpoints.MCP.URL)
	fmt.Printf("  REST: %s\n", info.Endpoints.REST.URL)
	fmt.Printf("  Docs: %s\n", info.Endpoints.Docs.URL)
	fmt.Println()
	fmt.Println("Quickstart:")
	for _, step := range info.Quickstart.Steps {
		fmt.Printf("  %s\n", step)
	}
	fmt.Println()
	fmt.Printf("%s\n", info.ForAgents.Message)
	fmt.Printf("%s\n", info.ForAgents.Invitation)

	return nil
}
