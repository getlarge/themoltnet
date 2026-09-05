package main

// Stable release update discovery intentionally has no relationship with the
// API client or credentials.  In particular, `update check` must remain useful
// on an uninitialised machine and safe to run from CI.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// Update discovery asks GitHub which cli releases exist, not
// themolt.net/download/manifest.json.  That manifest serves the deliberately
// pinned version behind /install and /download/*, which is a reviewed decision
// about what the website hands a brand-new user — not a statement about what
// has shipped.  Homebrew, apt, scoop and npm all receive a release the moment
// the release job finishes, so sourcing the *notification* from the pin only
// hid versions users could already install, for as long as the pin PR sat
// unmerged.
const updateReleasesURL = "https://api.github.com/repos/getlarge/themoltnet/releases?per_page=100"
const updateCacheTTL = 24 * time.Hour
const updateTagPrefix = "cli-v"

// Package variables make the transport boundary testable without changing the
// public endpoint used by released binaries.
var cliUpdateReleasesURL = updateReleasesURL
var cliUpdateHTTPClient = &http.Client{}

type githubRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

type updateCache struct {
	CheckedAt time.Time `json:"checkedAt"`
	Latest    string    `json:"latest,omitempty"`
	Error     string    `json:"error,omitempty"`
}

type updateResult struct {
	Current         string `json:"currentVersion"`
	Latest          string `json:"latestVersion,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	InstallMethod   string `json:"installMethod"`
	ReleaseURL      string `json:"releaseUrl"`
	Command         string `json:"command"`
}

func newUpdateCmd(version string) *cobra.Command {
	var jsonOutput bool
	check := &cobra.Command{
		Use:   "check",
		Short: "Check the stable MoltNet CLI release",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			result, err := checkCLIUpdate(cmd.Context(), version, true)
			if err != nil {
				return err
			}
			if jsonOutput {
				return json.NewEncoder(cmd.OutOrStdout()).Encode(result)
			}
			if result.UpdateAvailable {
				fmt.Fprintf(cmd.OutOrStdout(), "MoltNet CLI %s is available (you have %s). Run: %s\\n", result.Latest, result.Current, result.Command)
			} else {
				fmt.Fprintf(cmd.OutOrStdout(), "MoltNet CLI %s is up to date.\\n", result.Current)
			}
			return nil
		},
	}
	check.Flags().BoolVar(&jsonOutput, "json", false, "Print machine-readable JSON")
	parent := &cobra.Command{Use: "update", Short: "Inspect MoltNet CLI updates", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error { return cmd.Help() }}
	parent.AddCommand(check)
	return parent
}

func checkCLIUpdate(ctx context.Context, current string, force bool) (updateResult, error) {
	exe, _ := os.Executable()
	exe = resolveCLIExecutable(exe)
	method := detectCLIInstallMethod(exe)
	result := updateResult{Current: normalVersion(current), InstallMethod: method, ReleaseURL: "https://themolt.net/download", Command: cliUpdateCommand(method, exe)}
	cache, cacheErr := readUpdateCache("cli")
	if !force && cacheErr == nil && time.Since(cache.CheckedAt) < updateCacheTTL {
		result.Latest = cache.Latest
		result.UpdateAvailable = compareVersions(result.Latest, result.Current) > 0
		return result, nil
	}
	latest, err := fetchCLILatest(ctx)
	if err != nil {
		_ = writeUpdateCache("cli", updateCache{CheckedAt: time.Now().UTC(), Error: err.Error()})
		return result, fmt.Errorf("could not check for MoltNet CLI updates: %w", err)
	}
	_ = writeUpdateCache("cli", updateCache{CheckedAt: time.Now().UTC(), Latest: latest})
	result.Latest = latest
	result.UpdateAvailable = compareVersions(latest, result.Current) > 0
	return result, nil
}

func fetchCLILatest(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cliUpdateReleasesURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "moltnet-cli")
	res, err := cliUpdateHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("release listing returned HTTP %d", res.StatusCode)
	}
	var releases []githubRelease
	if err := json.NewDecoder(res.Body).Decode(&releases); err != nil {
		return "", fmt.Errorf("invalid release listing: %w", err)
	}
	latest := ""
	for _, release := range releases {
		// An unauthenticated caller never sees drafts, but a token in CI does,
		// and this repository carries stuck drafts months old — one would
		// otherwise masquerade as the newest release.  Same lesson as
		// tools/ci/check-download-pins.sh.
		if release.Draft || release.Prerelease {
			continue
		}
		if !strings.HasPrefix(release.TagName, updateTagPrefix) {
			continue
		}
		candidate := strings.TrimPrefix(release.TagName, updateTagPrefix)
		if !validVersion(candidate) {
			continue
		}
		// The listing is ordered by creation date, not version: a patch cut on
		// an older line can appear ahead of a newer minor.  Compare every
		// candidate rather than trusting position.
		if latest == "" || compareVersions(candidate, latest) > 0 {
			latest = candidate
		}
	}
	if latest == "" {
		return "", errors.New("no valid CLI release found")
	}
	return latest, nil
}

func updateCachePath(product string) (string, error) {
	d, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "moltnet", "updates", product+".json"), nil
}
func readUpdateCache(product string) (updateCache, error) {
	var c updateCache
	p, err := updateCachePath(product)
	if err != nil {
		return c, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(b, &c)
	return c, err
}
func writeUpdateCache(product string, c updateCache) error {
	p, err := updateCachePath(product)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(p, b, 0600)
}

func normalVersion(v string) string { return strings.TrimPrefix(strings.TrimSpace(v), "v") }
func validVersion(v string) bool {
	p := strings.Split(normalVersion(v), ".")
	if len(p) != 3 {
		return false
	}
	for _, s := range p {
		if s == "" {
			return false
		}
		for _, r := range s {
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}
func compareVersions(a, b string) int {
	if !validVersion(a) || !validVersion(b) {
		return 0
	}
	var ai, bi [3]int
	fmt.Sscanf(normalVersion(a), "%d.%d.%d", &ai[0], &ai[1], &ai[2])
	fmt.Sscanf(normalVersion(b), "%d.%d.%d", &bi[0], &bi[1], &bi[2])
	for i := range ai {
		if ai[i] > bi[i] {
			return 1
		}
		if ai[i] < bi[i] {
			return -1
		}
	}
	return 0
}

// os.Executable reports the path the binary was invoked through, which for a
// Homebrew cask on macOS is the shim (/opt/homebrew/bin/moltnet), not its
// Caskroom target.  Install-method detection matches on the real location, so
// every macOS brew install was misreported as "direct" and offered the curl
// installer — which would overwrite Homebrew's symlink and desync its version
// tracking.  Linux was unaffected: os.Executable reads /proc/self/exe, which is
// already resolved.
func resolveCLIExecutable(exe string) string {
	if exe == "" {
		return exe
	}
	resolved, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return exe
	}
	return resolved
}

func detectCLIInstallMethod(exe string) string {
	p := filepath.ToSlash(exe)
	switch {
	case strings.Contains(p, "/Caskroom/moltnet/"):
		return "homebrew"
	case strings.Contains(p, "/scoop/apps/moltnet/"):
		return "scoop"
	case strings.Contains(p, "/node_modules/@themoltnet/cli/"):
		return "npm"
	case runtime.GOOS == "linux" && aptOwnsMoltnet(exe):
		return "apt"
	case strings.Contains(p, "/.local/share/moltnet/") || strings.Contains(p, "/opt/moltnet/"):
		return "standalone"
	default:
		return "direct"
	}
}
func aptOwnsMoltnet(exe string) bool {
	b, err := os.ReadFile("/var/lib/dpkg/info/moltnet.list")
	return err == nil && strings.Contains(string(b), exe)
}

func isCLIWorkspaceInvocation() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	return strings.Contains(filepath.ToSlash(exe), "/apps/moltnet-cli/")
}
func cliUpdateCommand(method, exe string) string {
	switch method {
	case "homebrew":
		// `brew upgrade` consults the local tap clone; third-party taps are not
		// in the core JSON API.  Without a fetch, a stale clone still advertises
		// the installed version and the upgrade no-ops with "already installed".
		return "brew update && brew upgrade --cask moltnet"
	case "apt":
		return "sudo apt update && sudo apt install --only-upgrade moltnet"
	case "scoop":
		// scoop-update.ps1 calls Sync-Bucket only when invoked with no app
		// argument, so `scoop update moltnet` alone never refreshes the bucket.
		return "scoop update && scoop update moltnet"
	case "npm":
		return "npm install -g @themoltnet/cli@latest"
	default:
		return fmt.Sprintf("curl -fsSL https://themolt.net/install/cli | sh -s -- --replace %q", exe)
	}
}
