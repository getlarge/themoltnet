package main

import (
	"fmt"
	"os"
	osExec "os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

func runStartCmd(cmd *cobra.Command, dir, agentFlag, target string, targetArgs []string, dryRun bool) error {
	return runStartCmdWithRegistry(cmd, dir, agentFlag, target, targetArgs, dryRun, NewSecretProviderRegistry())
}

func runStartCmdWithRegistry(cmd *cobra.Command, dir, agentFlag, target string, targetArgs []string, dryRun bool, registry *SecretProviderRegistry) error {
	return runStartCmdWithRegistryAndExec(cmd, dir, agentFlag, target, targetArgs, dryRun, registry, launchProcess)
}

type execProcess func(targetPath string, argv, env []string) error

func runStartCmdWithRegistryAndExec(cmd *cobra.Command, dir, agentFlag, target string, targetArgs []string, dryRun bool, registry *SecretProviderRegistry, execFn execProcess) error {
	moltnetDir, err := resolveMoltnetDir(dir)
	if err != nil {
		return err
	}
	agentName, err := resolveAgentName(moltnetDir, agentFlag)
	if err != nil {
		return err
	}

	envPath := filepath.Join(moltnetDir, agentName, "env")
	vars, err := parseEnvFile(envPath)
	if err != nil {
		return fmt.Errorf("env file not found at %s — run 'moltnet agents init --name %s'", envPath, agentName)
	}
	credentialVars, err := resolveAgentOAuth2Environment(filepath.Join(moltnetDir, agentName), agentName, registry)
	if err != nil {
		return err
	}
	for key, value := range credentialVars {
		vars[key] = value
	}
	launchConfigPath := filepath.Join(dir, ".moltnet", agentName, "moltnet.json")
	if !regularFileExists(launchConfigPath) {
		launchConfigPath = filepath.Join(moltnetDir, agentName, "moltnet.json")
	}
	launchConfigPath, err = filepath.Abs(launchConfigPath)
	if err != nil {
		return fmt.Errorf("resolve agent credentials path: %w", err)
	}
	vars["MOLTNET_CREDENTIALS_PATH"] = filepath.Clean(launchConfigPath)

	// Resolve target binary
	targetPath, err := osExec.LookPath(target)
	if err != nil {
		return fmt.Errorf("%q not found in PATH", target)
	}

	// Resolve relative paths in env vars against the .moltnet directory's
	// parent (repo root). This ensures paths like .moltnet/<agent>/gitconfig
	// work correctly when launched from a linked worktree where .moltnet/
	// was resolved from the main worktree.
	repoRoot := filepath.Dir(moltnetDir)
	paths := newAgentPathResolver(repoRoot, filepath.Join(moltnetDir, agentName), agentName)
	for k, v := range vars {
		if k == "GIT_CONFIG_GLOBAL" && v != "" {
			vars[k] = paths.resolveFile(v, "gitconfig")
		}
	}

	// Build environment: current env with agent env vars replacing any
	// inherited duplicates. Appending would leave stale values from a
	// previous session visible to the child process.
	envMap := make(map[string]string)
	for _, entry := range os.Environ() {
		if idx := strings.IndexByte(entry, '='); idx > 0 {
			envMap[entry[:idx]] = entry[idx+1:]
		}
	}
	for k, v := range vars {
		envMap[k] = v
	}
	env := make([]string, 0, len(envMap))
	for k, v := range envMap {
		env = append(env, k+"="+v)
	}

	if dryRun {
		fmt.Fprintf(cmd.OutOrStdout(), "Agent: %s\n", agentName)
		fmt.Fprintf(cmd.OutOrStdout(), "Target: %s (%s)\n\n", target, targetPath)
		if len(targetArgs) > 0 {
			fmt.Fprintln(cmd.OutOrStdout(), "Forwarded target arguments:")
			for _, arg := range targetArgs {
				fmt.Fprintf(cmd.OutOrStdout(), "  %s\n", strconv.Quote(arg))
			}
			fmt.Fprintln(cmd.OutOrStdout())
		}
		fmt.Fprintln(cmd.OutOrStdout(), "Environment variables from env file:")
		keys := make([]string, 0, len(vars))
		for k := range vars {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			v := vars[k]
			if isSecretKey(k) {
				v = "***"
			}
			fmt.Fprintf(cmd.OutOrStdout(), "  %s=%s\n", k, v)
		}
		return nil
	}

	// exec replaces the current process
	argv := append([]string{target}, targetArgs...)
	return execFn(targetPath, argv, env)
}

func resolveAgentOAuth2Environment(agentDir, agentName string, registry *SecretProviderRegistry) (map[string]string, error) {
	configPath := filepath.Join(agentDir, "moltnet.json")
	creds, err := ReadConfigFrom(configPath)
	if err != nil {
		return nil, fmt.Errorf("load agent credentials: %w", err)
	}
	if creds == nil {
		return nil, fmt.Errorf("agent credentials not found at %s", configPath)
	}
	if strings.TrimSpace(creds.OAuth2.ClientID) == "" {
		return nil, fmt.Errorf("agent credentials are missing oauth2.client_id")
	}
	secret, err := resolveOAuth2Secret(creds, registry)
	if err != nil {
		return nil, fmt.Errorf("resolve OAuth2 client secret: %w", err)
	}
	prefix := toEnvPrefix(agentName)
	return map[string]string{
		"MOLTNET_CLIENT_ID":        creds.OAuth2.ClientID,
		"MOLTNET_CLIENT_SECRET":    secret,
		"MOLTNET_CREDENTIALS_PATH": configPath,
		prefix + "_CLIENT_ID":      creds.OAuth2.ClientID,
		prefix + "_CLIENT_SECRET":  secret,
	}, nil
}

// isSecretKey returns true for env var names that likely contain secrets.
func isSecretKey(key string) bool {
	return strings.HasSuffix(key, "_CLIENT_SECRET") ||
		strings.Contains(key, "_PRIVATE_KEY")
}
