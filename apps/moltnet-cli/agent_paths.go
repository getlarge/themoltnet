package main

import (
	"os"
	"path/filepath"
	"strings"
)

type agentPathResolver struct {
	repoRoot  string
	agentDir  string
	agentName string
}

func newAgentPathResolver(repoRoot, agentDir, agentName string) agentPathResolver {
	return agentPathResolver{
		repoRoot:  filepath.Clean(repoRoot),
		agentDir:  filepath.Clean(agentDir),
		agentName: agentName,
	}
}

func (r agentPathResolver) resolveFile(configured, defaultRelative string) string {
	candidates := r.candidatePaths(configured, defaultRelative)
	for _, candidate := range candidates {
		if regularFileExists(candidate) {
			return candidate
		}
	}
	if len(candidates) == 0 {
		return ""
	}
	return candidates[0]
}

func (r agentPathResolver) candidatePaths(configured, defaultRelative string) []string {
	var candidates []string
	if configured != "" {
		candidates = append(candidates, r.resolveConfiguredPath(configured))
		if rebased := r.rebaseMoltnetPath(configured); rebased != "" {
			candidates = append(candidates, rebased)
		}
	}
	if defaultRelative != "" {
		candidates = append(candidates, r.resolveDefaultPath(defaultRelative))
	}
	return uniqueCleanPaths(candidates)
}

func (r agentPathResolver) resolveConfiguredPath(configured string) string {
	if filepath.IsAbs(configured) {
		return filepath.Clean(configured)
	}
	return filepath.Clean(filepath.Join(r.repoRoot, configured))
}

func (r agentPathResolver) resolveDefaultPath(defaultRelative string) string {
	if filepath.IsAbs(defaultRelative) {
		return filepath.Clean(defaultRelative)
	}
	return filepath.Clean(filepath.Join(r.agentDir, defaultRelative))
}

func (r agentPathResolver) rebaseMoltnetPath(configured string) string {
	normalized := filepath.ToSlash(filepath.Clean(configured))
	marker := "/.moltnet/" + r.agentName + "/"
	idx := strings.Index(normalized, marker)
	if idx < 0 {
		return ""
	}
	suffix := normalized[idx+len(marker):]
	if suffix == "" {
		return ""
	}
	return filepath.Clean(filepath.Join(r.agentDir, filepath.FromSlash(suffix)))
}

func regularFileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func uniqueCleanPaths(paths []string) []string {
	seen := make(map[string]bool, len(paths))
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		if path == "" {
			continue
		}
		clean := filepath.Clean(path)
		if seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	return out
}

func portableAgentEnvPath(agentDir, agentName, path string) string {
	if path == "" {
		return ""
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	absAgentDir, err := filepath.Abs(agentDir)
	if err != nil {
		return path
	}
	rel, err := filepath.Rel(absAgentDir, absPath)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return path
	}
	return filepath.ToSlash(filepath.Join(".moltnet", agentName, rel))
}
