package main

import (
	"bufio"
	"fmt"
	"os"
	osExec "os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
	"github.com/spf13/cobra"
)

func runStartCmd(cmd *cobra.Command, agentFlag, target string, targetArgs []string, dryRun bool) error {
	return runStartCmdWithRegistry(cmd, agentFlag, target, targetArgs, dryRun, NewSecretProviderRegistry())
}

func runStartCmdWithRegistry(cmd *cobra.Command, agentFlag, target string, targetArgs []string, dryRun bool, registry *SecretProviderRegistry) error {
	return runStartCmdWithRegistryAndExec(cmd, agentFlag, target, targetArgs, dryRun, registry, launchProcess)
}

type execProcess func(targetPath string, argv, env []string) error

func runStartCmdWithRegistryAndExec(cmd *cobra.Command, agentFlag, target string, targetArgs []string, dryRun bool, registry *SecretProviderRegistry, execFn execProcess) error {
	agentName, err := resolveIdentityAlias(agentFlag)
	if err != nil {
		return err
	}
	agentDir, err := identityDir(agentName)
	if err != nil {
		return err
	}

	envPath := filepath.Join(agentDir, "env")
	vars, err := parseEnvFile(envPath)
	if err != nil {
		return fmt.Errorf("identity environment not found at %s — run 'moltnet agents init --name %s'", envPath, agentName)
	}
	configPath, bindingName := nativeProjectSelection(agentDir, nativeProjectOptionsFromCommand(cmd))
	if configPath == "" {
		configPath, err = projectconfig.Path()
		if err != nil {
			return err
		}
	}
	configPath, err = filepath.Abs(configPath)
	if err != nil {
		return err
	}
	apiURL := resolveAPIURL(cmd, filepath.Join(agentDir, "moltnet.json"))
	if dryRun {
		if _, e := os.Lstat(contextStorePath(agentDir)); e == nil {
			fmt.Fprintln(cmd.ErrOrStderr(), "notice: legacy registrations are not used; a normal start requires one-time conversion with 'moltnet projects migrate'. Dry-run writes nothing.")
		}
	}
	if !dryRun {
		if err := migrateProjectsForCommand(cmd, agentDir, configPath, ""); err != nil {
			return err
		}
	}
	resolvedContext, err := resolveContextBindingWithProjectOptions(agentDir, "", configPath, bindingName, apiURL)
	if err != nil {
		return err
	}
	resolvedContext.writeSkippedEndpointNotice(cmd.ErrOrStderr())
	if !dryRun && bindingName == "" && resolvedContext.Project == nil && projectCommandInteractive(cmd) {
		reader := bufio.NewReader(cmd.InOrStdin())
		choice, setupErr := promptChoice(cmd.OutOrStdout(), reader, "No project registered for this folder", 2, func(i int) string { return []string{"Register a project", "Not now (use identity default)"}[i] })
		if setupErr == nil && choice == 0 {
			// Preserve buffered answers for the remaining prompts.
			cmd.SetIn(reader)
			setupErr = setupProjectForCommand(cmd, agentDir, configPath, "")
		}
		if setupErr != nil {
			fmt.Fprintf(cmd.ErrOrStderr(), "notice: project setup was not completed: %v; using identity defaults. Run 'moltnet projects setup' to retry.\n", setupErr)
		}
		resolvedContext, err = resolveContextBindingWithProjectOptions(agentDir, "", configPath, "", apiURL)
		if err != nil {
			return err
		}
	}
	switch resolvedContext.Source {
	case contextSourceLocation:
	case contextSourceIdentityDefault:
		fmt.Fprintf(cmd.ErrOrStderr(), "notice: no project registered for %s; using the identity default team and diary (run 'moltnet projects setup' to register this folder)\n", resolvedContext.Key)
	default:
		fmt.Fprintf(cmd.ErrOrStderr(), "notice: no project registered for %s and no identity default team and diary are set (run 'moltnet projects setup' to register this folder)\n", resolvedContext.Key)
	}
	if resolvedContext.Binding != nil {
		vars["MOLTNET_TEAM_ID"] = resolvedContext.Binding.TeamID
		vars["MOLTNET_DIARY_ID"] = resolvedContext.Binding.DiaryID
	}
	vars["MOLTNET_CONTEXT_KEY"] = resolvedContext.Key
	vars["MOLTNET_PROJECT_CONFIG"] = configPath
	// Preserve provenance: the SDK validates config-selected endpoints itself.
	// Only an operator-supplied flag or process environment is an explicit override.
	delete(vars, "MOLTNET_API_URL")
	if (cmd.Flag("api-url") != nil && cmd.Flag("api-url").Changed) || strings.TrimSpace(os.Getenv(apiURLEnv)) != "" {
		vars["MOLTNET_API_URL"] = apiURL
	}
	workingDirectory, err := contextWorkingDirectory()
	if err != nil {
		return err
	}
	if project := resolvedContext.Project; project != nil {
		vars["MOLTNET_PROJECT_ID"] = project.ProjectID
		vars["MOLTNET_PROJECT_BINDING"] = project.Name
		if project.Source != "" {
			workingDirectory = project.Source
		}
	} else {
		vars["MOLTNET_PROJECT_ID"] = ""
		vars["MOLTNET_PROJECT_BINDING"] = ""
	}

	credentialVars, err := resolveAgentOAuth2Environment(agentDir, agentName, registry)
	if err != nil {
		return err
	}
	for key, value := range credentialVars {
		vars[key] = value
	}
	launchConfigPath := filepath.Join(agentDir, "moltnet.json")
	launchConfigPath, err = filepath.Abs(launchConfigPath)
	if err != nil {
		return fmt.Errorf("resolve agent credentials path: %w", err)
	}
	vars["MOLTNET_CREDENTIALS_PATH"] = filepath.Clean(launchConfigPath)
	vars["MOLTNET_ACTIVE_IDENTITY"] = agentName

	vars["PWD"] = workingDirectory
	// Resolve relative targets against the selected source, including during dry runs.
	lookupTarget := target
	if !filepath.IsAbs(target) && strings.ContainsAny(target, `/\`) {
		lookupTarget = filepath.Join(workingDirectory, target)
	}
	targetPath, err := osExec.LookPath(lookupTarget)
	if err != nil {
		if lookupTarget != target || filepath.IsAbs(target) {
			return fmt.Errorf("target %q could not be executed from directory %q: %w", lookupTarget, workingDirectory, err)
		}
		return fmt.Errorf("%q not found in PATH: %w", target, err)
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
		fmt.Fprintf(cmd.OutOrStdout(), "Working directory: %s\n", quoteStartValue(workingDirectory))
		fmt.Fprintf(cmd.OutOrStdout(), "Agent: %s\n", quoteStartValue(agentName))
		fmt.Fprintf(cmd.OutOrStdout(), "Target: %s (%s)\n\n", quoteStartValue(target), quoteStartValue(targetPath))
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
			fmt.Fprintf(cmd.OutOrStdout(), "  %s=%s\n", k, quoteStartValue(v))
		}
		return nil
	}

	if project := resolvedContext.Project; project != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "Project binding %q: source %q, endpoint %q\n", project.Name, workingDirectory, project.APIURL)
		if project.Strategy != "existing" && project.Strategy != "none" {
			fmt.Fprintln(cmd.ErrOrStderr(), "notice: native start runs in the source folder; isolated workspace preparation is performed by task workers")
		}
	}
	// exec replaces the current process
	argv := append([]string{target}, targetArgs...)
	originalDirectory, err := os.Getwd()
	if err != nil {
		return err
	}
	if err := os.Chdir(workingDirectory); err != nil {
		return fmt.Errorf("select project working directory: %w", err)
	}
	// Real exec replaces this process. Restore CWD when a test executor returns or launch fails.
	defer func() { _ = os.Chdir(originalDirectory) }()
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

// Keep ordinary dry-run values readable without allowing control characters to add lines.
func quoteStartValue(value string) string {
	if strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return strconv.Quote(value)
	}
	return value
}
