package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// trialScores holds parsed scores for a single trial.
type trialScores struct {
	name    string
	logDir  string
	reward  float64
	details map[string]float64
	err     string // non-empty if the trial failed
}

// evalResult holds the outcome for one eval task.
type evalResult struct {
	taskName       string
	withContext    *trialScores
	withoutContext *trialScores
}

// harborResult mirrors Harbor's result.json structure (partial).
type harborResult struct {
	Stats struct {
		NErrors int `json:"n_errors"`
		Evals   map[string]struct {
			RewardStats struct {
				Reward map[string][]string `json:"reward"`
			} `json:"reward_stats"`
		} `json:"evals"`
	} `json:"stats"`
}

func findJobDir(workDir string) (string, error) {
	jobsDir := filepath.Join(workDir, "jobs")
	entries, err := os.ReadDir(jobsDir)
	if err != nil {
		return "", fmt.Errorf("reading jobs dir: %w", err)
	}

	var latest string
	for _, e := range entries {
		if e.IsDir() {
			latest = e.Name()
		}
	}
	if latest == "" {
		return "", fmt.Errorf("no job directories found in %s", jobsDir)
	}
	return filepath.Join(jobsDir, latest), nil
}

func extractResults(jobDir string) ([]evalResult, error) {
	entries, err := os.ReadDir(jobDir)
	if err != nil {
		return nil, fmt.Errorf("reading job dir: %w", err)
	}

	type trialInfo struct {
		dir         string
		withContext bool
	}
	groups := make(map[string][]trialInfo)

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		parts := strings.SplitN(name, "__", 2)
		if len(parts) != 2 {
			continue
		}
		trialName := parts[0]
		isContext := strings.Contains(trialName, "-with-con")

		baseName := trialName
		if isContext {
			idx := strings.Index(baseName, "-with-con")
			baseName = baseName[:idx]
		}

		groups[baseName] = append(groups[baseName], trialInfo{
			dir:         filepath.Join(jobDir, name),
			withContext: isContext,
		})
	}

	baseNames := make([]string, 0, len(groups))
	for k := range groups {
		baseNames = append(baseNames, k)
	}
	sort.Strings(baseNames)

	var results []evalResult
	for _, baseName := range baseNames {
		result := evalResult{taskName: baseName}
		for _, t := range groups[baseName] {
			scores, err := readTrialScores(t.dir)
			if err != nil {
				fmt.Fprintf(
					os.Stderr,
					"warning: could not read scores for %s: %v\n",
					filepath.Base(t.dir),
					err,
				)
				continue
			}
			scores.name = filepath.Base(t.dir)
			scores.logDir = t.dir
			if t.withContext {
				result.withContext = scores
			} else {
				result.withoutContext = scores
			}
		}
		results = append(results, result)
	}
	return results, nil
}

func readTrialScores(trialDir string) (*trialScores, error) {
	scores := &trialScores{}
	hadException := false

	resultPath := filepath.Join(trialDir, "result.json")
	if data, err := os.ReadFile(resultPath); err == nil {
		var result struct {
			ExceptionInfo *struct {
				Type    string `json:"exception_type"`
				Message string `json:"exception_message"`
			} `json:"exception_info"`
		}
		if err := json.Unmarshal(data, &result); err == nil &&
			result.ExceptionInfo != nil {
			hadException = true
			scores.err = result.ExceptionInfo.Type
			if msg := result.ExceptionInfo.Message; len(msg) > 0 {
				switch {
				case strings.Contains(msg, "Not logged in"):
					scores.err += ": OAuth token expired — re-authenticate and retry"
				case strings.Contains(msg, "ECONNRESET") ||
					strings.Contains(msg, "TLS connect error"):
					scores.err += ": TLS connection failed — check Docker networking"
				case strings.Contains(msg, "timed out"):
					scores.err += ": agent timed out"
				}
			}
		}
	}

	if hadException {
		if detail := readTrialErrorDetail(trialDir); detail != "" {
			if scores.err != "" {
				scores.err += ": " + detail
			} else {
				scores.err = detail
			}
		}
	}

	rewardPath := filepath.Join(trialDir, "verifier", "reward.json")
	rewardData, err := os.ReadFile(rewardPath)
	if err != nil {
		if scores.err != "" {
			return scores, nil
		}
		return nil, fmt.Errorf("reading reward.json: %w", err)
	}

	var reward struct {
		Reward float64 `json:"reward"`
	}
	if err := json.Unmarshal(rewardData, &reward); err != nil {
		return nil, fmt.Errorf("parsing reward.json: %w", err)
	}
	scores.reward = reward.Reward

	scoresPath := filepath.Join(trialDir, "verifier", "scores.json")
	if data, err := os.ReadFile(scoresPath); err == nil {
		var details map[string]float64
		if err := json.Unmarshal(data, &details); err == nil {
			scores.details = details
		}
	}

	return scores, nil
}

func readTrialErrorDetail(trialDir string) string {
	for _, path := range []string{
		filepath.Join(trialDir, "exception.txt"),
	} {
		if detail := extractErrorDetailFromFile(path); detail != "" {
			return detail
		}
	}

	agentDir := filepath.Join(trialDir, "agent")
	entries, err := os.ReadDir(agentDir)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".txt") {
			continue
		}
		if detail := extractErrorDetailFromFile(filepath.Join(agentDir, entry.Name())); detail != "" {
			return detail
		}
	}
	return ""
}

func extractErrorDetailFromFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	lines := strings.Split(string(data), "\n")
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		switch {
		case strings.HasPrefix(line, "stdout: "):
			line = strings.TrimSpace(strings.TrimPrefix(line, "stdout: "))
		case strings.HasPrefix(line, "stderr: "):
			line = strings.TrimSpace(strings.TrimPrefix(line, "stderr: "))
		}

		switch {
		case strings.Contains(line, "Permission denied"):
			return line
		case strings.Contains(line, "Unauthorized"):
			return line
		case strings.Contains(line, "apiKeySource"):
			if strings.Contains(line, `"apiKeySource":"none"`) {
				return "Claude started without an auth source (apiKeySource:none)"
			}
		case strings.Contains(line, "ECONNRESET"):
			return line
		case strings.Contains(line, "Not logged in"):
			return line
		case strings.Contains(line, "Incorrect API key provided"):
			return line
		}
	}
	return ""
}
