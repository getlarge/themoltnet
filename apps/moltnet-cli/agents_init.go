package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

const (
	agentsInitStateFile           = "init-state.json"
	agentsInitPhaseStarted        = "started"
	agentsInitPhaseGitHubApp      = "github_app_ready"
	agentsInitPhaseRemoteComplete = "remote_complete"
)

var agentNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`)

type agentsInitOpts struct {
	apiURL         string
	apiURLExplicit bool
	name           string
	org            string
	noOpen         bool
	timeout        time.Duration
	out            io.Writer
	errOut         io.Writer
}

type agentsInitState struct {
	WorkflowID             string `json:"workflowId"`
	ManifestURL            string `json:"manifestUrl"`
	Phase                  string `json:"phase"`
	AppID                  string `json:"appId,omitempty"`
	AppSlug                string `json:"appSlug,omitempty"`
	SealedGitHubPrivateKey string `json:"sealedGitHubPrivateKey,omitempty"`
	IdentityID             string `json:"identityId,omitempty"`
	ClientID               string `json:"clientId,omitempty"`
	SealedClientSecret     string `json:"sealedClientSecret,omitempty"`
	InstallationID         string `json:"installationId,omitempty"`
}

type githubManifestCredentials struct {
	ID   int64  `json:"id"`
	Slug string `json:"slug"`
	PEM  string `json:"pem"`
}

func runAgentsInitCmd(opts agentsInitOpts) error {
	if err := validateAgentName(opts.name); err != nil {
		return err
	}
	if opts.timeout <= 0 {
		return fmt.Errorf("--timeout must be greater than zero")
	}
	if opts.out == nil {
		opts.out = os.Stdout
	}
	if opts.errOut == nil {
		opts.errOut = os.Stderr
	}

	// Identity material is user/deployment-local. A repository is no longer an
	// input to identity creation; future activation bindings are separate.
	agentDir, err := prepareIdentityDirectory(opts.name)
	if err != nil {
		return err
	}
	configPath := filepath.Join(agentDir, "moltnet.json")
	statePath := filepath.Join(agentDir, agentsInitStateFile)

	creds, err := ReadConfigFrom(configPath)
	if err != nil {
		return err
	}
	state, err := readAgentsInitState(statePath)
	if err != nil {
		return err
	}
	if state != nil && creds == nil {
		return fmt.Errorf("initialization state exists but credentials are missing: %s", configPath)
	}
	apiURL := strings.TrimRight(
		resolveAPIURLFromCredentials(opts.apiURL, opts.apiURLExplicit, creds),
		"/",
	)

	provider := OSKeyringSecretProvider{}
	if err := preflightAgentInitKeyring(provider); err != nil {
		return err
	}
	if state == nil && agentInitRemoteComplete(creds) {
		if err := completeCentralIdentityInit(opts, agentDir, configPath, creds); err != nil {
			return err
		}
		fmt.Fprintf(opts.out, "Agent %s is already initialized at %s\n", opts.name, configPath)
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	if state == nil {
		creds, state, err = startAgentsInit(ctx, apiURL, opts, configPath, statePath, provider)
		if err != nil {
			return err
		}
	} else if creds == nil {
		return fmt.Errorf("cannot resume initialization: %s is missing", configPath)
	}

	seed, err := resolveIdentitySeed(creds, NewSecretProviderRegistry())
	if err != nil {
		return fmt.Errorf("resolve onboarding identity key: %w", err)
	}
	client, err := newPublicAPIClient(apiURL)
	if err != nil {
		return err
	}
	if state.Phase == agentsInitPhaseStarted {
		announceBrowserStep(opts, "Create the GitHub App", state.ManifestURL)
		status, pollErr := pollAgentsInit(
			ctx,
			client,
			state.WorkflowID,
			moltnetapi.GetLegreffierOnboardingStatusOKStatusGithubCodeReady,
			moltnetapi.GetLegreffierOnboardingStatusOKStatusAwaitingInstallation,
			moltnetapi.GetLegreffierOnboardingStatusOKStatusCompleted,
		)
		if pollErr != nil {
			return pollErr
		}
		sealedCode, ok := status.GithubCode.Get()
		if !ok || sealedCode == "" {
			return fmt.Errorf("onboarding status did not include the GitHub manifest code")
		}
		code, decryptErr := DecryptFromAgent(sealedCode, seed)
		if decryptErr != nil {
			return fmt.Errorf("decrypt GitHub manifest code: %w", decryptErr)
		}
		githubCreds, exchangeErr := exchangeGitHubManifest(ctx, newAPIHTTPClient(), code)
		if exchangeErr != nil {
			return exchangeErr
		}
		sealedPEM, sealErr := EncryptForAgent(githubCreds.PEM, creds.Keys.PublicKey)
		if sealErr != nil {
			return fmt.Errorf("seal GitHub App private key for resume: %w", sealErr)
		}
		state.AppID = fmt.Sprintf("%d", githubCreds.ID)
		state.AppSlug = githubCreds.Slug
		state.SealedGitHubPrivateKey = sealedPEM
		state.Phase = agentsInitPhaseGitHubApp
		if err := writeAgentsInitState(statePath, state); err != nil {
			return err
		}
	}

	if state.Phase == agentsInitPhaseGitHubApp || state.Phase == agentsInitPhaseRemoteComplete {
		githubPEM, decryptErr := DecryptFromAgent(state.SealedGitHubPrivateKey, seed)
		if decryptErr != nil {
			return fmt.Errorf("decrypt checkpointed GitHub App private key: %w", decryptErr)
		}
		githubRef := SecretReference{
			Provider: osKeyringProviderName,
			Key:      GitHubAppPrivateKeyKey(state.AppID),
		}
		if err := provider.Set(githubRef.Key, githubPEM); err != nil {
			return fmt.Errorf("store GitHub App private key: %w", err)
		}
		org := opts.org
		if org == "" && creds.GitHub != nil {
			org = creds.GitHub.Org
		}
		creds.GitHub = &GitHubSection{
			AppID: state.AppID, AppSlug: state.AppSlug,
			PrivateKeyRef: &githubRef, Org: org,
		}
		if _, err := WriteConfigTo(creds, configPath); err != nil {
			return err
		}
	}

	if state.Phase != agentsInitPhaseRemoteComplete {
		installURL := fmt.Sprintf("https://github.com/apps/%s/installations/new", state.AppSlug)
		announceBrowserStep(opts, "Install the GitHub App", installURL)
		status, pollErr := pollAgentsInit(
			ctx,
			client,
			state.WorkflowID,
			moltnetapi.GetLegreffierOnboardingStatusOKStatusCompleted,
		)
		if pollErr != nil {
			return pollErr
		}
		identityID, ok := status.IdentityId.Get()
		if !ok || identityID == "" {
			return fmt.Errorf("completed onboarding did not include an identity ID")
		}
		clientID, ok := status.ClientId.Get()
		if !ok || clientID == "" {
			return fmt.Errorf("completed onboarding did not include an OAuth2 client ID")
		}
		sealedSecret, ok := status.ClientSecret.Get()
		if !ok || sealedSecret == "" {
			return fmt.Errorf("completed onboarding did not include the sealed OAuth2 secret")
		}
		installationID, ok := status.InstallationId.Get()
		if !ok || installationID == "" {
			return fmt.Errorf("completed onboarding did not include a GitHub installation ID")
		}
		state.IdentityID = identityID
		state.ClientID = clientID
		state.SealedClientSecret = sealedSecret
		state.InstallationID = installationID
		state.Phase = agentsInitPhaseRemoteComplete
		if err := writeAgentsInitState(statePath, state); err != nil {
			return err
		}
	}

	clientSecret, err := DecryptFromAgent(state.SealedClientSecret, seed)
	if err != nil {
		return fmt.Errorf("decrypt checkpointed OAuth2 client secret: %w", err)
	}
	oauthRef := SecretReference{
		Provider: osKeyringProviderName,
		Key:      OAuth2SecretKey(state.IdentityID, state.ClientID),
	}
	if err := provider.Set(oauthRef.Key, clientSecret); err != nil {
		return fmt.Errorf("store OAuth2 client secret: %w", err)
	}
	creds.IdentityID = state.IdentityID
	creds.OAuth2 = CredentialsOAuth2{ClientID: state.ClientID, ClientSecretRef: &oauthRef}
	creds.RegisteredAt = time.Now().UTC().Format(time.RFC3339Nano)
	creds.GitHub.InstallationID = state.InstallationID
	if _, err := WriteConfigTo(creds, configPath); err != nil {
		return err
	}

	if err := completeCentralIdentityInit(opts, agentDir, configPath, creds); err != nil {
		return err
	}
	if err := os.Remove(statePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove initialization state: %w", err)
	}
	fmt.Fprintf(opts.out, "Initialized %s (%s)\n", opts.name, creds.Keys.Fingerprint)
	fmt.Fprintf(opts.out, "Credentials: %s\n", configPath)
	fmt.Fprintln(opts.out, "Install the LeGreffier plugin in your agent host to add skills, hooks, and MCP access.")
	return nil
}

func prepareIdentityDirectory(alias string) (string, error) {
	dir, err := identityDir(alias)
	if err != nil {
		return "", err
	}
	if info, statErr := os.Lstat(dir); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("identity directory must not be a symbolic link: %s", dir)
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return "", fmt.Errorf("inspect identity directory: %w", statErr)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create identity directory: %w", err)
	}
	if err := rejectAgentPathSymlinks(dir); err != nil {
		return "", err
	}
	return dir, nil
}

func startAgentsInit(ctx context.Context, apiURL string, opts agentsInitOpts, configPath, statePath string, provider OSKeyringSecretProvider) (*CredentialsFile, *agentsInitState, error) {
	kp, err := GenerateKeyPair()
	if err != nil {
		return nil, nil, err
	}
	nonce, err := newRegistrationNonce()
	if err != nil {
		return nil, nil, err
	}
	proof, err := SignRawMessage(
		buildSelfRegistrationMessage(nonce, kp.PublicKey, credentialTypeOAuth2),
		kp.PrivateKey,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("sign onboarding request: %w", err)
	}
	client, err := newPublicAPIClient(apiURL)
	if err != nil {
		return nil, nil, err
	}
	req := &moltnetapi.StartLegreffierOnboardingReq{
		AgentName: opts.name, CredentialType: moltnetapi.StartLegreffierOnboardingReqCredentialTypeOAuth2,
		Fingerprint: kp.Fingerprint, Proof: proof, PublicKey: kp.PublicKey,
	}
	if opts.org != "" {
		req.Org = moltnetapi.NewOptString(opts.org)
	}
	res, err := client.StartLegreffierOnboarding(ctx, req, moltnetapi.StartLegreffierOnboardingParams{IdempotencyKey: nonce})
	if err != nil {
		return nil, nil, fmt.Errorf("start onboarding: %w", formatTransportError(err))
	}
	started, ok := res.(*moltnetapi.StartLegreffierOnboardingOK)
	if !ok {
		return nil, nil, fmt.Errorf("start onboarding: %w", formatAPIError(res))
	}
	seedRef := SecretReference{Provider: osKeyringProviderName, Key: IdentitySeedKey(kp.Fingerprint)}
	if err := provider.Set(seedRef.Key, kp.PrivateKey); err != nil {
		return nil, nil, fmt.Errorf("store identity seed: %w", err)
	}
	creds := &CredentialsFile{
		Keys:         CredentialsKeys{PublicKey: kp.PublicKey, PrivateKeyRef: &seedRef, Fingerprint: kp.Fingerprint},
		Endpoints:    CredentialsEndpoints{API: apiURL, MCP: deriveMCPURL(apiURL)},
		RegisteredAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if _, err := WriteConfigTo(creds, configPath); err != nil {
		return nil, nil, err
	}
	state := &agentsInitState{WorkflowID: started.WorkflowId, ManifestURL: started.ManifestFormUrl, Phase: agentsInitPhaseStarted}
	if err := writeAgentsInitState(statePath, state); err != nil {
		return nil, nil, err
	}
	fmt.Fprintf(opts.errOut, "Generated identity %s\n", kp.Fingerprint)
	return creds, state, nil
}

func newPublicAPIClient(apiURL string) (*moltnetapi.Client, error) {
	client, err := moltnetapi.NewClient(apiURL, nil, moltnetapi.WithClient(newAPIHTTPClient()))
	if err != nil {
		return nil, fmt.Errorf("create API client: %w", err)
	}
	return client, nil
}

func pollAgentsInit(ctx context.Context, client *moltnetapi.Client, workflowID string, targets ...moltnetapi.GetLegreffierOnboardingStatusOKStatus) (*moltnetapi.GetLegreffierOnboardingStatusOK, error) {
	wanted := make(map[moltnetapi.GetLegreffierOnboardingStatusOKStatus]bool, len(targets))
	for _, target := range targets {
		wanted[target] = true
	}
	for {
		res, err := client.GetLegreffierOnboardingStatus(ctx, moltnetapi.GetLegreffierOnboardingStatusParams{WorkflowId: workflowID})
		if err != nil {
			return nil, fmt.Errorf("poll onboarding: %w", formatTransportError(err))
		}
		status, ok := res.(*moltnetapi.GetLegreffierOnboardingStatusOK)
		if !ok {
			return nil, fmt.Errorf("poll onboarding: %w", formatAPIError(res))
		}
		if status.Status == moltnetapi.GetLegreffierOnboardingStatusOKStatusFailed {
			return nil, fmt.Errorf("onboarding workflow failed")
		}
		if wanted[status.Status] {
			return status, nil
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timed out waiting for GitHub onboarding: %w", ctx.Err())
		case <-time.After(time.Second):
		}
	}
}

func exchangeGitHubManifest(ctx context.Context, client *http.Client, code string) (*githubManifestCredentials, error) {
	url := fmt.Sprintf("%s/app-manifests/%s/conversions", strings.TrimRight(githubAPIBaseURL, "/"), code)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange GitHub manifest: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return nil, fmt.Errorf("exchange GitHub manifest (%d): %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var credentials githubManifestCredentials
	if err := json.NewDecoder(res.Body).Decode(&credentials); err != nil {
		return nil, fmt.Errorf("decode GitHub manifest response: %w", err)
	}
	if credentials.ID == 0 || credentials.Slug == "" || credentials.PEM == "" {
		return nil, fmt.Errorf("GitHub manifest response is incomplete")
	}
	return &credentials, nil
}

func announceBrowserStep(opts agentsInitOpts, label, url string) {
	fmt.Fprintf(opts.errOut, "%s:\n  %s\n", label, url)
	if opts.noOpen {
		return
	}
	if err := openBrowser(url); err != nil {
		fmt.Fprintf(opts.errOut, "Browser did not open: %v\n", err)
	}
}

func validateAgentName(name string) error {
	if !agentNamePattern.MatchString(name) {
		return fmt.Errorf("--name must be 1-63 characters using only letters, numbers, '.', '_', or '-', and must start with a letter or number")
	}
	return nil
}

func prepareAgentDirectory(repoRoot, agentName string) (string, error) {
	moltnetDir := filepath.Join(repoRoot, ".moltnet")
	if err := os.MkdirAll(moltnetDir, 0o700); err != nil {
		return "", fmt.Errorf("create .moltnet directory: %w", err)
	}
	resolvedMoltnetDir, err := filepath.EvalSymlinks(moltnetDir)
	if err != nil {
		return "", fmt.Errorf("resolve .moltnet directory: %w", err)
	}
	agentDir := filepath.Join(moltnetDir, agentName)
	if info, statErr := os.Lstat(agentDir); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("agent directory must not be a symbolic link: %s", agentDir)
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return "", fmt.Errorf("inspect agent directory: %w", statErr)
	}
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		return "", fmt.Errorf("create agent directory: %w", err)
	}
	resolvedAgentDir, err := filepath.EvalSymlinks(agentDir)
	if err != nil {
		return "", fmt.Errorf("resolve agent directory: %w", err)
	}
	rel, err := filepath.Rel(resolvedMoltnetDir, resolvedAgentDir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("agent directory escapes repository .moltnet directory")
	}
	if err := rejectAgentPathSymlinks(agentDir); err != nil {
		return "", err
	}
	return agentDir, nil
}

func rejectAgentPathSymlinks(agentDir string) error {
	for _, relativePath := range []string{
		"moltnet.json",
		agentsInitStateFile,
		configPortStateFile,
		"env",
		"gitconfig",
		"ssh",
		filepath.Join("ssh", "id_ed25519"),
		filepath.Join("ssh", "id_ed25519.pub"),
	} {
		path := filepath.Join(agentDir, relativePath)
		info, err := os.Lstat(path)
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("managed agent path must not be a symbolic link: %s", path)
		}
		if err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("inspect managed agent path: %w", err)
		}
	}
	return nil
}

func completeCentralIdentityInit(opts agentsInitOpts, identityDir, configPath string, creds *CredentialsFile) error {
	if !agentInitRemoteComplete(creds) {
		return fmt.Errorf("cannot complete local setup before remote credentials are complete")
	}
	if err := rejectAgentPathSymlinks(identityDir); err != nil {
		return err
	}
	if err := runSSHKeyExportCmd(configPath, filepath.Join(identityDir, "ssh")); err != nil {
		return err
	}
	if err := runGitHubSetupCmd(configPath, opts.name, creds.GitHub.AppSlug); err != nil {
		return err
	}
	if err := writeIdentityEnv(identityDir, opts.name, creds); err != nil {
		return err
	}
	// Seed the selector when none exists, as register / init-from-env /
	// migrate all do. Without this the primary onboarding path left no default
	// identity, so every later command failed with "no active identity
	// selected" unless MOLTNET_ACTIVE_IDENTITY was exported by hand.
	if selector, err := readIdentitySelector(); err != nil {
		return err
	} else if selector == nil || selector.DefaultIdentity == "" {
		if err := writeIdentitySelector(opts.name); err != nil {
			return err
		}
	}
	// Warm the activation cache so `agents activation validate` does not
	// report invalid immediately after a successful init.
	return runAgentsActivationRefreshCmd(io.Discard, opts.name, false)
}

func writeIdentityEnv(identityDir, alias string, creds *CredentialsFile) error {
	prefix := toEnvPrefix(alias)
	gitconfig := filepath.Join(identityDir, "gitconfig")
	content := fmt.Sprintf(
		"%s_CLIENT_ID='%s'\n%s_GITHUB_APP_ID='%s'\n%s_GITHUB_APP_INSTALLATION_ID='%s'\nGIT_CONFIG_GLOBAL='%s'\nMOLTNET_ACTIVE_IDENTITY='%s'\nMOLTNET_FINGERPRINT='%s'\n",
		prefix, shellQuote(creds.OAuth2.ClientID), prefix, shellQuote(creds.GitHub.AppID), prefix, shellQuote(creds.GitHub.InstallationID),
		shellQuote(gitconfig), shellQuote(alias), shellQuote(creds.Keys.Fingerprint),
	)
	if err := writeFileAtomic(filepath.Join(identityDir, "env"), []byte(content)); err != nil {
		return fmt.Errorf("write identity env: %w", err)
	}
	return nil
}

func openBrowser(url string) error {
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command, args = "open", []string{url}
	case "windows":
		command, args = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	default:
		command, args = "xdg-open", []string{url}
	}
	return exec.Command(command, args...).Start()
}

func preflightAgentInitKeyring(provider OSKeyringSecretProvider) error {
	key := fmt.Sprintf("preflight/%d/%d", os.Getpid(), time.Now().UnixNano())
	if err := provider.Set(key, "credential-store-preflight"); err != nil {
		return fmt.Errorf("OS keyring is unavailable; initialization was not attempted: %w", err)
	}
	if err := provider.Delete(key); err != nil {
		return fmt.Errorf("OS keyring cleanup failed; initialization was not attempted: %w", err)
	}
	return nil
}

func agentInitRemoteComplete(creds *CredentialsFile) bool {
	return creds != nil && creds.IdentityID != "" && creds.OAuth2.ClientID != "" &&
		creds.GitHub != nil && creds.GitHub.AppID != "" && creds.GitHub.InstallationID != ""
}

func readAgentsInitState(path string) (*agentsInitState, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read initialization state: %w", err)
	}
	var state agentsInitState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("parse initialization state: %w", err)
	}
	if state.WorkflowID == "" {
		return nil, fmt.Errorf("initialization state is missing workflowId")
	}
	if state.Phase == "" {
		switch {
		case state.IdentityID != "" || state.ClientID != "" || state.InstallationID != "":
			state.Phase = agentsInitPhaseRemoteComplete
		case state.AppID != "":
			state.Phase = agentsInitPhaseGitHubApp
		default:
			state.Phase = agentsInitPhaseStarted
		}
	}
	switch state.Phase {
	case agentsInitPhaseStarted:
		if state.ManifestURL == "" {
			return nil, fmt.Errorf("started initialization checkpoint is missing manifestUrl")
		}
	case agentsInitPhaseGitHubApp:
		if state.AppID == "" || state.AppSlug == "" || state.SealedGitHubPrivateKey == "" {
			return nil, fmt.Errorf("GitHub App checkpoint is incomplete")
		}
	case agentsInitPhaseRemoteComplete:
		if state.AppID == "" || state.AppSlug == "" || state.SealedGitHubPrivateKey == "" ||
			state.IdentityID == "" || state.ClientID == "" || state.SealedClientSecret == "" || state.InstallationID == "" {
			return nil, fmt.Errorf("remote-complete initialization checkpoint is incomplete")
		}
	default:
		return nil, fmt.Errorf("initialization state has unknown phase %q", state.Phase)
	}
	return &state, nil
}

func writeAgentsInitState(path string, state *agentsInitState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := writeFileAtomic(path, data); err != nil {
		return fmt.Errorf("write initialization state: %w", err)
	}
	return nil
}
