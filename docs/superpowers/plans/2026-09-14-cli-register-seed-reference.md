# CLI register stores the seed as a reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `moltnet register --name <alias>` stores the Ed25519 seed and the
OAuth2 secret as references in a secret provider, writes the config in an order
that keeps the identity recoverable, and refuses to overwrite an existing alias.

**Architecture:** `runRegisterCmdWithName` becomes a thin wrapper over
`runRegister(registerOpts)`, which takes a `SecretProviderRegistry` and a
destination provider name so tests can use the file provider. The keypair is
generated and its seed stored before the network call; `DoRegister` is split so
the network step accepts a prepared keypair. After registration the config is
written with both references before the OAuth2 secret is stored, so a failed
secret write leaves a recoverable identity and the error names
`moltnet agents credentials recover --yes`.

**Tech Stack:** Go (`apps/moltnet-cli`), cobra, `httptest`, the existing
`SecretProviderRegistry` with the `file` provider driven by
`MOLTNET_SECRET_ROOT`.

**Spec:**
`docs/superpowers/specs/2026-09-14-register-recover-onboarding-design.md`,
Component B.

## Global Constraints

- Work in this worktree on a branch cut from
  `feat/recover-or-mint-oauth2-client` (PR 1), named
  `fix/cli-register-seed-reference`.
- Every commit needs a LeGreffier diary entry first:
  `moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk <level> --scope "<areas>" --operator edouard --tool claude --title "<short title>" --rationale "<3-6 sentences>"`,
  then `MoltNet-Diary: <entryId>` in the commit body. Pass `--title` explicitly;
  the auto-derived title fails validation above 255 characters. Add
  `Task-Group: cli-register-seed-reference` to every commit,
  `Task-Family: bugfix` on the first, `Task-Completes: true` on the last.
- End every commit body with
  `Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS`.
- Conventional commit types, no `!` breaking marker.
- Go checks:
  `cd apps/moltnet-cli && gofmt -l . && go vet ./... && go test ./... -count=1`.
- Unit tests never touch the real OS keyring. Use the `file` provider with
  `t.Setenv(secretRootEnv, t.TempDir())` and
  `t.Setenv(secretRootWritableEnv, "1")`, and `t.Setenv("HOME", t.TempDir())` to
  relocate the identity store.
- This repository is public. Commit messages describe the mechanism, never a
  weakness.

---

## File structure

- Modify `apps/moltnet-cli/register.go`: split `DoRegister` into keypair
  generation plus `DoRegisterWithKeyPair`; replace the body of
  `runRegisterCmdWithName` with `runRegister(registerOpts)`; add
  `preflightSecretDestination`.
- Modify `apps/moltnet-cli/cobra_register.go`: add `--destination`.
- Modify `apps/moltnet-cli/register_test.go`: add a registration test server
  helper, a flaky provider, and four command-level tests.

---

### Task 1: Registration accepts a prepared keypair

**Files:**

- Modify: `apps/moltnet-cli/register.go:84-134`
- Test: `apps/moltnet-cli/register_test.go` (existing `TestDoRegisterSelfOAuth2`
  and `TestDoRegisterSelfAgentKey` keep passing)

**Interfaces:**

- Produces:

  ```go
  // DoRegisterWithKeyPair self-registers kp. DoRegister generates a keypair and delegates here.
  func DoRegisterWithKeyPair(apiURL, credentialType string, kp *KeyPair) (*RegisterResult, error)
  ```

- [ ] **Step 1: Split the function**

In `apps/moltnet-cli/register.go`, replace `DoRegister` with:

```go
// DoRegister generates a keypair and self-registers an identity. Team
// membership is managed separately through `moltnet teams join` after the
// registration credential has been stored.
func DoRegister(apiURL, credentialType string) (*RegisterResult, error) {
	if credentialType != credentialTypeOAuth2 && credentialType != credentialTypeAgentKey {
		return nil, fmt.Errorf("credential type must be oauth2 or agent_key")
	}
	kp, err := GenerateKeyPair()
	if err != nil {
		return nil, err
	}
	return DoRegisterWithKeyPair(apiURL, credentialType, kp)
}

// DoRegisterWithKeyPair self-registers an identity whose keypair the caller
// already holds. The register command stores the seed before calling this so
// the keypair survives a failure after the server has committed.
func DoRegisterWithKeyPair(apiURL, credentialType string, kp *KeyPair) (*RegisterResult, error) {
	if credentialType != credentialTypeOAuth2 && credentialType != credentialTypeAgentKey {
		return nil, fmt.Errorf("credential type must be oauth2 or agent_key")
	}
	if kp == nil {
		return nil, fmt.Errorf("registration requires a generated keypair")
	}
	nonce, err := newRegistrationNonce()
	if err != nil {
		return nil, err
	}
	message := buildSelfRegistrationMessage(nonce, kp.PublicKey, credentialType)
	proof, err := SignRawMessage(message, kp.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("sign registration request: %w", err)
	}

	client, err := moltnetapi.NewClient(
		strings.TrimRight(apiURL, "/"),
		nil,
		moltnetapi.WithClient(newAPIHTTPClient()),
	)
	if err != nil {
		return nil, fmt.Errorf("create API client: %w", err)
	}
	request := &moltnetapi.RegisterAgentReq{
		PublicKey: kp.PublicKey, Proof: proof,
		CredentialType: moltnetapi.RegisterAgentReqCredentialType(credentialType),
	}
	params := moltnetapi.RegisterAgentParams{IdempotencyKey: nonce}
	res, callErr := client.RegisterAgent(context.Background(), request, params)
	if callErr != nil {
		// The server may have committed before the response was dropped. Replay
		// this exact signed request once with the same idempotency nonce.
		res, callErr = client.RegisterAgent(context.Background(), request, params)
	}
	if callErr != nil {
		return nil, fmt.Errorf("registration request failed: %w", formatTransportError(callErr))
	}
	apiResponse, ok := res.(*moltnetapi.RegisterResponse)
	if !ok {
		return nil, fmt.Errorf("registration failed: %w", formatAPIError(res))
	}

	response, err := flattenRegistrationResponse(apiResponse)
	if err != nil {
		return nil, err
	}
	return &RegisterResult{KeyPair: kp, Response: response, APIUrl: strings.TrimRight(apiURL, "/")}, nil
}
```

- [ ] **Step 2: Run the existing registration tests**

Run: `cd apps/moltnet-cli && go test . -run 'TestDoRegister' -count=1` Expected:
PASS, unchanged behavior.

- [ ] **Step 3: Diary entry and commit**

```bash
git add apps/moltnet-cli/register.go
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk low --scope "cli,auth" --operator edouard --tool claude --title "refactor(cli): let registration accept a prepared keypair" --rationale "Splits DoRegister so the network step accepts a keypair the caller already holds. The register command will store the seed in a secret provider before calling the API, so a failure after the server commits never loses the keypair. No behavior change; the existing registration tests pass."
git commit -m "refactor(cli): let registration accept a prepared keypair" -m "MoltNet-Diary: <entryId>
Task-Group: cli-register-seed-reference
Task-Family: bugfix

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 2: `register` stores references and keeps the identity recoverable

**Files:**

- Modify: `apps/moltnet-cli/register.go:136-206`
- Modify: `apps/moltnet-cli/cobra_register.go`
- Test: `apps/moltnet-cli/register_test.go`

**Interfaces:**

- Consumes: `DoRegisterWithKeyPair` (Task 1), `SecretProviderRegistry` (`Store`,
  `Delete`, `CanWrite`), `validateMigrationDestination(registry, destination)`
  which maps `""` to the default `os-keyring`, `IdentitySeedKey(fingerprint)`,
  `OAuth2SecretKey(subjectID, clientID)`, `identityCredentialsPath(alias)`,
  `writeCentralIdentityConfig(alias, config)`, `reportRegistrationStored(...)`.
- Produces:

  ```go
  type registerOpts struct {
  	stdout, errOut  io.Writer
  	apiURL          string
  	credentialType  string
  	name            string
  	destination     string // secret provider; "" means os-keyring
  	jsonOut, noMCP  bool
  	secretProviders *SecretProviderRegistry // nil means NewSecretProviderRegistry()
  }
  func runRegister(opts registerOpts) error
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/moltnet-cli/register_test.go`:

```go
// newRegisterTestServer answers /auth/register with a fixed OAuth2 credential
// and 404 for everything else, so alias publication fails softly and the test
// exercises the local persistence path only.
func newRegisterTestServer(t *testing.T, status int) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/register" {
			http.NotFound(w, r)
			return
		}
		calls.Add(1)
		var body capturedRegistrationRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if status != http.StatusOK {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"type": "https://themolt.net/problems/invalid-proof", "title": "rejected", "status": status,
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId":     "00000000-0000-4000-a000-000000000123",
			"identityId":  "00000000-0000-0000-0000-000000000123",
			"fingerprint": "ABCD-1234-EF56-7890", "publicKey": body.PublicKey,
			"credential": map[string]any{"type": "oauth2", "clientId": "client-id", "clientSecret": "client-secret"},
		})
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

// flakySecretProvider stores in memory and fails Set for one exact key.
type flakySecretProvider struct {
	values  map[string]string
	failKey string
}

func (p *flakySecretProvider) Get(key string) (string, error) {
	value, ok := p.values[key]
	if !ok {
		return "", ErrSecretNotFound
	}
	return value, nil
}

func (p *flakySecretProvider) Set(key, value string) error {
	if key == p.failKey {
		return errors.New("simulated store failure")
	}
	if p.values == nil {
		p.values = map[string]string{}
	}
	p.values[key] = value
	return nil
}

func (p *flakySecretProvider) Delete(key string) error {
	delete(p.values, key)
	return nil
}

func (p *flakySecretProvider) CanWrite() bool { return true }

func TestRegisterStoresSeedAndSecretAsReferences(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(secretRootEnv, t.TempDir())
	t.Setenv(secretRootWritableEnv, "1")
	server, calls := newRegisterTestServer(t, http.StatusOK)

	root := NewRootCmd("test", "")
	_, stderr, err := executeCommand(root, "register", "--name", "reg-test", "--api-url", server.URL, "--destination", fileProviderName)
	if err != nil {
		t.Fatalf("register: %v\nstderr: %s", err, stderr)
	}
	if calls.Load() != 1 {
		t.Fatalf("registration calls = %d, want 1", calls.Load())
	}

	path, err := identityCredentialsPath("reg-test")
	if err != nil {
		t.Fatal(err)
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if creds.SubjectID != "00000000-0000-4000-a000-000000000123" || creds.SubjectType != SubjectTypeAgent {
		t.Fatalf("subject = %q/%q", creds.SubjectID, creds.SubjectType)
	}
	if creds.Keys.PrivateKey != "" || creds.Keys.PrivateKeyRef == nil ||
		creds.Keys.PrivateKeyRef.Provider != fileProviderName ||
		creds.Keys.PrivateKeyRef.Key != IdentitySeedKey(creds.Keys.Fingerprint) {
		t.Fatalf("seed was not stored as a reference: %#v", creds.Keys)
	}
	if creds.OAuth2.ClientSecret != "" || creds.OAuth2.ClientSecretRef == nil ||
		creds.OAuth2.ClientSecretRef.Provider != fileProviderName ||
		creds.OAuth2.ClientSecretRef.Key != OAuth2SecretKey(creds.SubjectID, "client-id") {
		t.Fatalf("OAuth2 secret was not stored as a reference: %#v", creds.OAuth2)
	}
	registry := NewSecretProviderRegistry()
	seed, err := registry.Resolve(*creds.Keys.PrivateKeyRef)
	if err != nil {
		t.Fatalf("resolve seed: %v", err)
	}
	if err := assertSeedMatchesPublicKey(seed, creds.Keys.PublicKey); err != nil {
		t.Fatalf("stored seed does not match public key: %v", err)
	}
	if secret, err := registry.Resolve(*creds.OAuth2.ClientSecretRef); err != nil || secret != "client-secret" {
		t.Fatalf("resolve OAuth2 secret = %q, %v", secret, err)
	}
	selector, err := readIdentitySelector()
	if err != nil || selector == nil || selector.DefaultIdentity != "reg-test" {
		t.Fatalf("selector = %#v, %v; want default reg-test", selector, err)
	}
	if strings.Contains(stderr, "client-secret") {
		t.Fatal("OAuth2 secret leaked to stderr")
	}
}

func TestRegisterRejectedRegistrationRemovesSeed(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	secretRoot := t.TempDir()
	t.Setenv(secretRootEnv, secretRoot)
	t.Setenv(secretRootWritableEnv, "1")
	server, _ := newRegisterTestServer(t, http.StatusBadRequest)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "register", "--name", "reg-rejected", "--api-url", server.URL, "--destination", fileProviderName)
	if err == nil {
		t.Fatal("expected registration to fail")
	}

	path, err := identityCredentialsPath("reg-rejected")
	if err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("config must not exist after a rejected registration: %v", statErr)
	}
	entries, err := os.ReadDir(secretRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("secret root should be empty after cleanup, has %d entries", len(entries))
	}
}

func TestRegisterKeepsIdentityRecoverableWhenSecretStoreFails(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	server, _ := newRegisterTestServer(t, http.StatusOK)
	provider := &flakySecretProvider{failKey: OAuth2SecretKey("00000000-0000-4000-a000-000000000123", "client-id")}
	registry := NewSecretProviderRegistry()
	registry.Register("flaky", provider)
	var stderr bytes.Buffer

	err := runRegister(registerOpts{
		stdout: &bytes.Buffer{}, errOut: &stderr,
		apiURL: server.URL, credentialType: credentialTypeOAuth2, name: "reg-flaky",
		destination: "flaky", secretProviders: registry,
	})

	if err == nil || !strings.Contains(err.Error(), "moltnet agents credentials recover --yes") {
		t.Fatalf("error = %v, want recovery guidance", err)
	}
	path, pathErr := identityCredentialsPath("reg-flaky")
	if pathErr != nil {
		t.Fatal(pathErr)
	}
	creds, readErr := ReadConfigFrom(path)
	if readErr != nil {
		t.Fatalf("config must survive a secret store failure: %v", readErr)
	}
	if creds.Keys.PrivateKeyRef == nil || creds.OAuth2.ClientSecretRef == nil || creds.OAuth2.ClientID != "client-id" {
		t.Fatalf("config is missing the references recovery needs: %#v", creds)
	}
	if _, seedErr := provider.Get(creds.Keys.PrivateKeyRef.Key); seedErr != nil {
		t.Fatalf("seed must remain stored: %v", seedErr)
	}
}

func TestRegisterRefusesExistingAlias(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(secretRootEnv, t.TempDir())
	t.Setenv(secretRootWritableEnv, "1")
	server, calls := newRegisterTestServer(t, http.StatusOK)
	path, err := identityCredentialsPath("reg-dup")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := WriteConfigTo(&CredentialsFile{SubjectID: "existing", SubjectType: SubjectTypeAgent}, path); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "register", "--name", "reg-dup", "--api-url", server.URL, "--destination", fileProviderName)

	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("error = %v, want existing-alias refusal", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("registration calls = %d, want 0", calls.Load())
	}
}
```

Add `"errors"`, `"os"`, and `"sync/atomic"` to the test file imports.
`assertSeedMatchesPublicKey` lives in `config_migrations_credentials.go`;
`ErrSecretNotFound` and `readIdentitySelector` already exist.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/moltnet-cli && go test . -run 'TestRegister' -count=1` Expected:
compile failure on `runRegister`/`registerOpts`, or the first test failing on
`unknown flag: --destination`.

- [ ] **Step 3: Implement `runRegister`**

In `apps/moltnet-cli/register.go`, replace `runRegisterCmdWithName` (lines
140-199) with:

```go
type registerOpts struct {
	stdout, errOut  io.Writer
	apiURL          string
	credentialType  string
	name            string
	destination     string
	jsonOut, noMCP  bool
	secretProviders *SecretProviderRegistry
}

func runRegisterCmdWithName(stdout, errOut io.Writer, apiURL, credentialType string, jsonOut, noMCP bool, name string) error {
	return runRegister(registerOpts{
		stdout: stdout, errOut: errOut, apiURL: apiURL, credentialType: credentialType,
		jsonOut: jsonOut, noMCP: noMCP, name: name,
	})
}

// preflightSecretDestination proves the provider can store and remove a value
// before any remote identity exists, so a missing keyring fails here.
func preflightSecretDestination(registry *SecretProviderRegistry, destination string) error {
	ref := SecretReference{
		Provider: destination,
		Key:      fmt.Sprintf("preflight/%d/%d", os.Getpid(), time.Now().UnixNano()),
	}
	if err := registry.Store(ref, "credential-store-preflight"); err != nil {
		return err
	}
	return registry.Delete(ref)
}

func runRegister(opts registerOpts) error {
	url := strings.TrimRight(opts.apiURL, "/")
	if !opts.jsonOut {
		if strings.TrimSpace(opts.name) == "" {
			return fmt.Errorf("--name is required unless --json is used")
		}
		if err := validateAgentName(opts.name); err != nil {
			return err
		}
	}
	if opts.credentialType == credentialTypeAgentKey && !opts.jsonOut {
		return fmt.Errorf("agent_key bootstrap credentials are one-time secrets; use --json and store the result securely")
	}
	if opts.jsonOut {
		fmt.Fprintln(opts.errOut, "Generating Ed25519 keypair...")
		result, err := DoRegister(url, opts.credentialType)
		if err != nil {
			return err
		}
		fmt.Fprintf(opts.errOut, "Registered as %s (fingerprint: %s)\n", result.Response.SubjectID, result.KeyPair.Fingerprint)
		return outputJSON(opts.stdout, result)
	}

	registry := opts.secretProviders
	if registry == nil {
		registry = NewSecretProviderRegistry()
	}
	destination, err := validateMigrationDestination(registry, opts.destination)
	if err != nil {
		return fmt.Errorf("registration was not attempted: %w", err)
	}
	if err := preflightSecretDestination(registry, destination); err != nil {
		return fmt.Errorf("secret provider %q is unavailable; registration was not attempted: %w", destination, err)
	}
	credPath, err := identityCredentialsPath(opts.name)
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(credPath); statErr == nil {
		return fmt.Errorf("identity %q already exists at %s; choose another --name or remove it first", opts.name, credPath)
	}

	fmt.Fprintln(opts.errOut, "Generating Ed25519 keypair...")
	kp, err := GenerateKeyPair()
	if err != nil {
		return err
	}
	// The seed is durable before the network call so a failure after the
	// server commits can never lose the keypair.
	seedRef := SecretReference{Provider: destination, Key: IdentitySeedKey(kp.Fingerprint)}
	if err := registry.Store(seedRef, kp.PrivateKey); err != nil {
		return fmt.Errorf("store identity seed in %s; registration was not attempted: %w", destination, err)
	}

	result, err := DoRegisterWithKeyPair(url, opts.credentialType, kp)
	if err != nil {
		_ = registry.Delete(seedRef)
		return err
	}
	fmt.Fprintf(opts.errOut, "Registered as %s (fingerprint: %s)\n", result.Response.SubjectID, result.KeyPair.Fingerprint)

	credential := result.Response.Credential
	secretRef := SecretReference{
		Provider: destination,
		Key:      OAuth2SecretKey(result.Response.SubjectID, credential.ClientID),
	}
	// The config carries both references before the OAuth2 secret exists.
	// From here on `moltnet agents credentials recover --yes` can replace a
	// missing secret, so nothing below may delete the seed or the config.
	credPath, err = writeCentralIdentityConfig(opts.name, &CredentialsFile{
		SubjectID:    result.Response.SubjectID,
		SubjectType:  result.Response.SubjectType,
		OAuth2:       CredentialsOAuth2{ClientID: credential.ClientID, ClientSecretRef: &secretRef},
		Keys:         CredentialsKeys{PublicKey: kp.PublicKey, PrivateKeyRef: &seedRef, Fingerprint: kp.Fingerprint},
		Endpoints:    CredentialsEndpoints{API: result.APIUrl, MCP: deriveMCPURL(url)},
		RegisteredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return fmt.Errorf(
			"the agent %s (fingerprint %s) is registered and its seed is stored under %s:%s, but the credentials file could not be written: %w",
			result.Response.SubjectID, kp.Fingerprint, seedRef.Provider, seedRef.Key, err,
		)
	}
	if err := registry.Store(secretRef, credential.ClientSecret); err != nil {
		fmt.Fprintf(opts.errOut, "Credentials written to %s\n", credPath)
		return fmt.Errorf(
			"store OAuth2 secret in %s: %w\nThe identity is registered and its config is written. Replace the secret with: MOLTNET_ACTIVE_IDENTITY=%s moltnet agents credentials recover --yes",
			destination, err, opts.name,
		)
	}
	fmt.Fprintf(opts.errOut, "Credentials written to %s\n", credPath)
	reportRegistrationStored(opts.errOut, result.APIUrl, credPath, opts.name, opts.noMCP)
	return nil
}
```

Remove the now-unused direct `OSKeyringSecretProvider{}` calls from this file.
`os` and `time` are already imported.

- [ ] **Step 4: Add the flag**

In `apps/moltnet-cli/cobra_register.go`, read the flag in `RunE` and pass it
through:

```go
			destination, _ := cmd.Flags().GetString("destination")
			return runRegister(registerOpts{
				stdout: cmd.OutOrStdout(), errOut: cmd.ErrOrStderr(),
				apiURL: apiURL, credentialType: credentialType, name: name,
				destination: destination, jsonOut: jsonOut, noMCP: noMCP,
			})
```

and declare it next to the other flags:

```go
	cmd.Flags().String("destination", "", "Secret provider that stores the identity seed and OAuth2 secret (default os-keyring)")
```

Update the `Long` text so the second sentence reads:
`Generates an Ed25519 keypair, stores its seed in the OS keyring, signs the registration request locally, and requests OAuth2 client credentials that are stored in the same keyring.`

- [ ] **Step 5: Run the tests**

Run:
`cd apps/moltnet-cli && gofmt -l . && go vet ./... && go test ./... -count=1`
Expected: gofmt prints nothing, vet is clean, all tests PASS including the four
new ones. `TestReportRegistrationStoredPublishesAliasBestEffort` is untouched.

- [ ] **Step 6: Diary entry and commit**

```bash
git add apps/moltnet-cli/register.go apps/moltnet-cli/cobra_register.go apps/moltnet-cli/register_test.go
moltnet entry commit --diary-id 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396 --risk high --scope "cli,auth" --operator edouard --tool claude --title "fix(cli): register stores the seed and secret as references" --rationale "moltnet register now stores the Ed25519 seed in the chosen secret provider before the network call, writes the config with both references right after the server commits, and stores the OAuth2 secret last, so a failure at any point after registration leaves an identity that moltnet agents credentials recover --yes can complete. The seed no longer lands in moltnet.json as plaintext, which removes the migration step a fresh registration needed. An existing alias is refused before any remote call. A --destination flag mirrors the recovery and migration commands and gives tests a file-provider path; the OS keyring stays the default."
git commit -m "fix(cli): register stores the seed and secret as references" -m "MoltNet-Diary: <entryId>
Task-Group: cli-register-seed-reference
Task-Completes: true

Claude-Session: https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS"
```

---

### Task 3: Pull request

- [ ] **Step 1: Push and open the PR against PR 1's branch**

```bash
git push -u origin fix/cli-register-seed-reference
moltnet github exec -- gh pr create --base feat/recover-or-mint-oauth2-client --head fix/cli-register-seed-reference \
  --title "fix(cli): register stores the identity seed as a reference" \
  --body-file <body file>
```

The body lists the write order, the recovery guidance, the new flag, and the Go
test run; it ends with
`https://claude.ai/code/session_015FWKhcNAMs5RKTEkA3bLsS`. Retarget the base as
the stack merges.
