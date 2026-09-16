use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Output, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const CONSOLE_URL: &str = "https://console.themolt.net/runtime/local";
const HEALTH_URL: &str = "https://127.0.0.1:17374/health";
const MAX_LOG_LINES: usize = 400;
const MAX_PERSISTED_LOG_BYTES: u64 = 1024 * 1024;
const MAX_START_ATTEMPTS: usize = 2;
const HEALTH_CHECK_TIMEOUT_SECS: &str = "1";
const START_TIMEOUT: Duration = Duration::from_secs(12);
const STOP_TIMEOUT: Duration = Duration::from_secs(17);
const EMBEDDED_INSTALLER: &str = include_str!(concat!(env!("OUT_DIR"), "/install-agent.sh"));

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleState {
    #[default]
    Checking,
    NeedsInstall,
    Installing,
    NeedsTrust,
    Starting,
    Running,
    UpdateAvailable,
    Stopping,
    Stopped,
    Removed,
    Failed,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    pub state: LifecycleState,
    pub installed_version: Option<String>,
    pub available_version: Option<String>,
    pub trust_fingerprint: Option<String>,
    pub trusted: bool,
    pub message: String,
    pub logs: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    latest_version: Option<String>,
    update_available: bool,
}

#[derive(Debug, Deserialize)]
struct TrustResult {
    trusted: bool,
    fingerprint: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct AgentCapabilities {
    supervised: bool,
    machine_trust: bool,
}

#[derive(Debug, Eq, PartialEq)]
pub enum ExitAction {
    None,
    Retry,
    Failed,
}

#[derive(Debug, Eq, PartialEq)]
enum UpdateOutcome {
    Updated,
    RolledBack { update_error: String },
}

enum UpdateStep<'a> {
    Install(&'a str),
    Start,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StartOrigin {
    Explicit,
    CrashRecovery,
}

struct LogBuffer {
    lines: VecDeque<String>,
    path: PathBuf,
    file: Option<File>,
    persisted_bytes: u64,
}

impl LogBuffer {
    fn new(path: PathBuf) -> Self {
        Self {
            lines: VecDeque::new(),
            path,
            file: None,
            persisted_bytes: 0,
        }
    }

    fn push(&mut self, line: String) -> Result<(), String> {
        self.lines.push_back(line.clone());
        while self.lines.len() > MAX_LOG_LINES {
            self.lines.pop_front();
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let persisted = format!("[{timestamp}] {line}\n");
        self.prepare_file(persisted.len() as u64)?;
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "persistent log file was not opened".to_string())?;
        file.write_all(persisted.as_bytes())
            .and_then(|_| file.flush())
            .map_err(|error| error.to_string())?;
        self.persisted_bytes += persisted.len() as u64;
        Ok(())
    }

    fn prepare_file(&mut self, additional_bytes: u64) -> Result<(), String> {
        if self.file.is_some()
            && self.persisted_bytes.saturating_add(additional_bytes) <= MAX_PERSISTED_LOG_BYTES
        {
            return Ok(());
        }

        self.file = None;
        let directory = self
            .path
            .parent()
            .ok_or_else(|| "persistent log path has no parent".to_string())?;
        prepare_private_directory(directory)?;
        reject_symlink(&self.path)?;

        let existing_bytes = fs::metadata(&self.path)
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        if existing_bytes.saturating_add(additional_bytes) > MAX_PERSISTED_LOG_BYTES {
            let rotated = self.path.with_extension("log.1");
            reject_symlink(&rotated)?;
            if rotated.exists() {
                fs::remove_file(&rotated).map_err(|error| error.to_string())?;
            }
            if self.path.exists() {
                fs::rename(&self.path, rotated).map_err(|error| error.to_string())?;
            }
            self.persisted_bytes = 0;
        } else {
            self.persisted_bytes = existing_bytes;
        }

        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        let file = options
            .open(&self.path)
            .map_err(|error| error.to_string())?;
        #[cfg(unix)]
        fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
        self.file = Some(file);
        Ok(())
    }
}

pub struct LifecycleManager {
    status: DesktopStatus,
    child: Option<Child>,
    logs: Arc<Mutex<LogBuffer>>,
    retry_used: bool,
    home: PathBuf,
}

impl Default for LifecycleManager {
    fn default() -> Self {
        Self::new(home_directory().expect("HOME is required on macOS"))
    }
}

impl LifecycleManager {
    pub fn new(home: PathBuf) -> Self {
        let log_path = home.join(".config/moltnet/agent-server/logs/desktop-supervisor.log");
        Self {
            status: DesktopStatus {
                state: LifecycleState::Checking,
                message: "Checking the local agent bundle…".into(),
                ..DesktopStatus::default()
            },
            child: None,
            logs: Arc::new(Mutex::new(LogBuffer::new(log_path))),
            retry_used: false,
            home,
        }
    }

    pub fn snapshot(&self) -> DesktopStatus {
        let mut status = self.status.clone();
        status.logs = self
            .logs
            .lock()
            .map(|logs| logs.lines.iter().cloned().collect())
            .unwrap_or_default();
        status
    }

    pub fn initialize(&mut self) -> Result<DesktopStatus, String> {
        if !self.executable().is_file() {
            self.set_state(
                LifecycleState::NeedsInstall,
                "The verified agent bundle needs to be installed.",
            );
            return self.install_agent();
        }
        self.refresh_installed_version();
        let capabilities = self.agent_capabilities()?;
        let trust = self.trust_status(capabilities)?;
        self.apply_trust(&trust);
        if !trust.trusted {
            self.set_state(
                LifecycleState::NeedsTrust,
                "Approve the per-user local CA before the Agent Server starts.",
            );
            return Ok(self.snapshot());
        }
        self.start_server_with(capabilities)
    }

    pub fn install_agent(&mut self) -> Result<DesktopStatus, String> {
        self.set_state(
            LifecycleState::Installing,
            "Downloading and verifying the pinned agent bundle…",
        );
        if let Err(error) = self.run_installer(None, false) {
            return self.fail(&format!("verified Agent CLI installation failed: {error}"));
        }
        self.refresh_installed_version();
        let capabilities = self.agent_capabilities()?;
        let trust = self.trust_status(capabilities)?;
        self.apply_trust(&trust);
        if trust.trusted {
            self.start_server_with(capabilities)
        } else {
            self.set_state(
                LifecycleState::NeedsTrust,
                "The verified bundle is installed. Local HTTPS trust needs consent.",
            );
            Ok(self.snapshot())
        }
    }

    pub fn approve_trust(&mut self) -> Result<DesktopStatus, String> {
        let capabilities = self.agent_capabilities()?;
        let trust = if capabilities.machine_trust {
            let output = self.run_agent(&["server", "trust", "--yes", "--json"])?;
            serde_json::from_slice(&output.stdout)
                .map_err(|error| format!("invalid trust response: {error}"))?
        } else {
            self.approve_legacy_trust()?;
            self.legacy_trust_status()?
        };
        if !trust.trusted {
            return self.fail("macOS did not report the local CA as trusted");
        }
        self.apply_trust(&trust);
        self.start_server_with(capabilities)
    }

    pub fn check_for_updates(&mut self) -> Result<DesktopStatus, String> {
        self.require_installed()?;
        let output = self.run_agent(&["update", "check", "--json"])?;
        let update: UpdateResult = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("invalid update response: {error}"))?;
        self.status.available_version = update.latest_version.clone();
        if update.update_available && update.latest_version.is_none() {
            return self.fail("the update response omitted its available version");
        }
        if let Some(latest_version) = update.latest_version.filter(|_| update.update_available) {
            self.set_state(
                LifecycleState::UpdateAvailable,
                &format!("Agent {latest_version} is ready to install after consent."),
            );
        } else {
            self.set_state(LifecycleState::Running, "The agent bundle is up to date.");
        }
        Ok(self.snapshot())
    }

    pub fn install_update(&mut self) -> Result<DesktopStatus, String> {
        self.install_update_with(|manager, step| match step {
            UpdateStep::Install(target) => {
                manager.run_installer(Some(target), false)?;
                manager.refresh_installed_version();
                Ok(())
            }
            UpdateStep::Start => {
                manager.retry_used = false;
                manager.start_server().map(|_| ())
            }
        })
    }

    fn install_update_with(
        &mut self,
        mut perform: impl FnMut(&mut Self, UpdateStep<'_>) -> Result<(), String>,
    ) -> Result<DesktopStatus, String> {
        let version = self
            .status
            .available_version
            .clone()
            .ok_or_else(|| "check for an agent update first".to_string())?;
        if !valid_version(&version) {
            return self.fail("the reported update version was not a stable semantic version");
        }
        let Some(previous_version) = self.status.installed_version.clone() else {
            return self
                .fail("the installed Agent CLI version is unavailable; reinstall before updating");
        };
        if !valid_version(&previous_version) {
            return self
                .fail("the installed Agent CLI version is invalid; reinstall before updating");
        }
        self.stop_server()?;
        self.set_state(
            LifecycleState::Installing,
            &format!("Installing verified agent {version}…"),
        );
        let outcome = execute_update(&version, &previous_version, |step| perform(self, step))
            .inspect_err(|error| {
                let _ = self.fail::<()>(error);
            })?;
        match outcome {
            UpdateOutcome::Updated => {
                self.status.available_version = None;
                Ok(self.snapshot())
            }
            UpdateOutcome::RolledBack { update_error } => {
                self.status.available_version = Some(version.clone());
                self.set_state(
                    LifecycleState::UpdateAvailable,
                    &format!(
                        "Agent CLI {version} did not become ready. Version {previous_version} was restored."
                    ),
                );
                self.push_log(&format!(
                    "Agent CLI update failed ({update_error}); rolled back to {previous_version}."
                ));
                Err(format!(
                    "Agent CLI {version} failed readiness; restored {previous_version}: {update_error}"
                ))
            }
        }
    }

    pub fn remove_bundle(&mut self, remove_local_ca: bool) -> Result<DesktopStatus, String> {
        self.stop_server()?;
        if remove_local_ca && self.executable().is_file() {
            self.remove_local_trust()?;
            self.status.trusted = false;
        }
        self.run_installer(None, true)?;
        self.status.installed_version = None;
        self.status.available_version = None;
        self.set_state(
            LifecycleState::Removed,
            "The agent bundle was removed. ~/.config/moltnet was preserved.",
        );
        Ok(self.snapshot())
    }

    pub fn remove_trust(&mut self) -> Result<DesktopStatus, String> {
        self.require_installed()?;
        let trust = self.remove_local_trust()?;
        self.apply_trust(&trust);
        self.set_state(
            LifecycleState::NeedsTrust,
            "Local HTTPS trust was removed. Re-approve it before starting the server.",
        );
        Ok(self.snapshot())
    }

    pub fn retry(&mut self) -> Result<DesktopStatus, String> {
        self.retry_used = false;
        self.initialize()
    }

    pub fn stop_server(&mut self) -> Result<DesktopStatus, String> {
        let Some(mut child) = self.child.take() else {
            return Ok(self.snapshot());
        };
        self.set_state(LifecycleState::Stopping, "Stopping the Agent Server…");
        drop(child.stdin.take());
        let pid = child.id() as libc::pid_t;
        // SAFETY: pid belongs to the Child this manager spawned and still owns.
        unsafe { libc::kill(pid, libc::SIGTERM) };
        let deadline = Instant::now() + STOP_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    self.push_log(&format!(
                        "Agent Server stopped ({})",
                        describe_exit_status(status)
                    ));
                    break;
                }
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
                Ok(None) => {
                    self.push_log(&format!(
                        "Agent Server did not stop within {} seconds; sending SIGKILL.",
                        STOP_TIMEOUT.as_secs()
                    ));
                    child
                        .kill()
                        .map_err(|error| format!("force stop failed: {error}"))?;
                    let _ = child.wait();
                    break;
                }
                Err(error) => {
                    return self.fail(&format!("could not observe Agent Server: {error}"))
                }
            }
        }
        self.set_state(LifecycleState::Stopped, "The Agent Server is stopped.");
        Ok(self.snapshot())
    }

    pub fn inspect_exit(&mut self) -> ExitAction {
        let status = self
            .child
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten());
        let Some(status) = status else {
            return ExitAction::None;
        };
        self.child = None;
        self.push_log(&format!(
            "Agent Server exited unexpectedly ({}).",
            describe_exit_status(status)
        ));
        if !self.retry_used {
            self.retry_used = true;
            self.set_state(
                LifecycleState::Starting,
                "The Agent Server exited unexpectedly. Retrying once…",
            );
            return ExitAction::Retry;
        }
        self.set_state(
            LifecycleState::Failed,
            "The Agent Server exited unexpectedly. Use Retry after reviewing logs.",
        );
        ExitAction::Failed
    }

    pub fn retry_after_exit(&mut self) -> Result<DesktopStatus, String> {
        if self.status.state != LifecycleState::Starting || self.child.is_some() || !self.retry_used
        {
            return Ok(self.snapshot());
        }
        self.start_server_for(StartOrigin::CrashRecovery)
    }

    pub fn open_console(&self) -> Result<(), String> {
        fixed_command("/usr/bin/open", &[CONSOLE_URL]).map(|_| ())
    }

    pub fn open_logs(&self) -> Result<(), String> {
        prepare_private_directory(&self.logs_directory())?;
        let path = self.logs_directory().to_string_lossy().into_owned();
        fixed_command("/usr/bin/open", &[&path]).map(|_| ())
    }

    pub fn start_server(&mut self) -> Result<DesktopStatus, String> {
        self.start_server_for(StartOrigin::Explicit)
    }

    fn start_server_for(&mut self, origin: StartOrigin) -> Result<DesktopStatus, String> {
        self.require_installed()?;
        let capabilities = self.agent_capabilities()?;
        self.start_server_with_origin(capabilities, origin)
    }

    fn start_server_with(
        &mut self,
        capabilities: AgentCapabilities,
    ) -> Result<DesktopStatus, String> {
        self.start_server_with_origin(capabilities, StartOrigin::Explicit)
    }

    fn start_server_with_origin(
        &mut self,
        capabilities: AgentCapabilities,
        origin: StartOrigin,
    ) -> Result<DesktopStatus, String> {
        self.require_installed()?;
        if self.child.is_none() && health_ready().is_ok() {
            return self.fail(
                "Another process already owns the local Agent Server. It was left untouched.",
            );
        }
        if !capabilities.supervised {
            self.push_log(
                "Installed Agent CLI does not support supervised stdin shutdown; using signal-owned compatibility mode.",
            );
        }
        self.set_state(LifecycleState::Starting, "Starting the Agent Server…");

        let mut last_failure = "Agent Server failed to start".to_string();
        for attempt in 0..MAX_START_ATTEMPTS {
            let mut command = agent_server_command(&self.executable(), capabilities);
            let mut child = match command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(error) => return self.fail(&format!("could not start Agent Server: {error}")),
            };
            if let Some(stdout) = child.stdout.take() {
                capture_lines(stdout, Arc::clone(&self.logs), attempt + 1, "stdout");
            }
            if let Some(stderr) = child.stderr.take() {
                capture_lines(stderr, Arc::clone(&self.logs), attempt + 1, "stderr");
            }
            let deadline = Instant::now() + START_TIMEOUT;
            loop {
                let health_error = match health_ready() {
                    Ok(()) => {
                        self.child = Some(child);
                        self.retry_used = retry_budget_after_start(origin, attempt);
                        self.set_state(
                            LifecycleState::Running,
                            "Ready. Open Console to pair this server process.",
                        );
                        return Ok(self.snapshot());
                    }
                    Err(error) => error,
                };
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    last_failure = format!(
                        "Agent Server exited before readiness ({})",
                        describe_exit_status(status)
                    );
                    self.push_log(&last_failure);
                    if attempt + 1 < MAX_START_ATTEMPTS {
                        self.push_log("Retrying Agent Server startup once.");
                    }
                    break;
                }
                if Instant::now() >= deadline {
                    self.push_log(&format!(
                        "Agent Server readiness exceeded {} seconds; force-stopping child.",
                        START_TIMEOUT.as_secs()
                    ));
                    let _ = child.kill();
                    let _ = child.wait();
                    return self.fail(&format!(
                        "Agent Server did not become ready within {} seconds; last health probe: {health_error}",
                        START_TIMEOUT.as_secs()
                    ));
                }
                thread::sleep(Duration::from_millis(200));
            }
        }
        self.fail(&last_failure)
    }

    fn trust_status(&self, capabilities: AgentCapabilities) -> Result<TrustResult, String> {
        if capabilities.machine_trust {
            let output = self.run_agent(&["server", "trust", "--status", "--json"])?;
            serde_json::from_slice(&output.stdout)
                .map_err(|error| format!("invalid trust status response: {error}"))
        } else {
            self.legacy_trust_status()
        }
    }

    fn agent_capabilities(&self) -> Result<AgentCapabilities, String> {
        let output = self.run_agent(&["server", "--help"])?;
        Ok(parse_agent_capabilities(&output.stdout))
    }

    fn legacy_trust_status(&self) -> Result<TrustResult, String> {
        let Ok(ca) = fs::read_to_string(self.local_ca_path()) else {
            return Ok(TrustResult {
                trusted: false,
                fingerprint: None,
            });
        };
        let output = legacy_trust_inspection_command(&self.login_keychain_path())
            .output()
            .map_err(|error| format!("could not inspect the macOS login keychain: {error}"))?;
        Ok(TrustResult {
            trusted: legacy_trust_matches(ca.trim(), output.status.success(), &output.stdout),
            fingerprint: None,
        })
    }

    fn approve_legacy_trust(&self) -> Result<(), String> {
        if !self.local_ca_path().is_file() {
            let output = Command::new(self.executable())
                .arg("server")
                .output()
                .map_err(|error| format!("could not prepare local HTTPS material: {error}"))?;
            if !self.local_ca_path().is_file() {
                return Err(command_failure("local HTTPS preparation", &output));
            }
        }
        let output =
            legacy_trust_approval_command(&self.login_keychain_path(), &self.local_ca_path())
                .output()
                .map_err(|error| format!("could not update the macOS login keychain: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_failure("macOS local HTTPS trust", &output))
        }
    }

    fn remove_local_trust(&self) -> Result<TrustResult, String> {
        if self.agent_capabilities()?.machine_trust {
            let output = self.run_agent(&["server", "trust", "--remove", "--yes", "--json"])?;
            serde_json::from_slice(&output.stdout)
                .map_err(|error| format!("invalid trust removal response: {error}"))
        } else {
            self.run_agent(&["server", "trust", "--remove"])?;
            Ok(TrustResult {
                trusted: false,
                fingerprint: None,
            })
        }
    }

    fn apply_trust(&mut self, trust: &TrustResult) {
        self.status.trusted = trust.trusted;
        self.status.trust_fingerprint = trust.fingerprint.clone();
    }

    fn run_agent(&self, args: &[&str]) -> Result<Output, String> {
        let output = Command::new(self.executable())
            .args(args)
            .output()
            .map_err(|error| format!("agent command failed: {error}"))?;
        if output.status.success() {
            Ok(output)
        } else {
            Err(command_failure("agent command", &output))
        }
    }

    fn run_installer(&self, version: Option<&str>, uninstall: bool) -> Result<(), String> {
        let mut script = tempfile::Builder::new()
            .prefix("moltnet-agent-desktop-installer-")
            .suffix(".sh")
            .tempfile()
            .map_err(|error| error.to_string())?;
        script
            .write_all(EMBEDDED_INSTALLER.as_bytes())
            .map_err(|error| error.to_string())?;
        script.flush().map_err(|error| error.to_string())?;
        let mut command =
            installer_command(script.path(), &self.install_root(), version, uninstall);
        let output = command.output().map_err(|error| error.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_failure("Agent CLI installer", &output))
        }
    }

    fn refresh_installed_version(&mut self) {
        let manifest = self.install_root().join("current/manifest.json");
        self.status.installed_version = fs::read_to_string(manifest)
            .ok()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
            .and_then(|value| value.get("version")?.as_str().map(str::to_owned));
    }

    fn require_installed(&self) -> Result<(), String> {
        self.executable()
            .is_file()
            .then_some(())
            .ok_or_else(|| "the canonical MoltNet agent bundle is not installed".into())
    }

    fn set_state(&mut self, state: LifecycleState, message: &str) {
        self.status.state = state;
        self.status.message = message.into();
    }

    fn fail<T>(&mut self, message: &str) -> Result<T, String> {
        self.set_state(LifecycleState::Failed, message);
        self.push_log(message);
        Err(message.into())
    }

    fn push_log(&self, line: &str) {
        if let Ok(mut logs) = self.logs.lock() {
            if let Err(error) = logs.push(line.to_string()) {
                eprintln!("could not persist Agent desktop supervisor log: {error}");
            }
        }
    }

    fn install_root(&self) -> PathBuf {
        self.home.join(".local/share/moltnet/agent")
    }

    fn executable(&self) -> PathBuf {
        self.install_root().join("current/bin/moltnet-agent")
    }

    fn logs_directory(&self) -> PathBuf {
        self.home.join(".config/moltnet/agent-server/logs")
    }

    fn local_ca_path(&self) -> PathBuf {
        self.home.join(".config/moltnet/tls/local-ca.pem")
    }

    fn login_keychain_path(&self) -> PathBuf {
        self.home.join("Library/Keychains/login.keychain-db")
    }
}

fn capture_lines(
    reader: impl std::io::Read + Send + 'static,
    logs: Arc<Mutex<LogBuffer>>,
    attempt: usize,
    stream: &'static str,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let (line, read_failed) = match line {
                Ok(line) => (
                    format!("Agent Server {stream} [attempt {attempt}]: {line}"),
                    false,
                ),
                Err(error) => (
                    format!("Could not read Agent Server {stream} [attempt {attempt}]: {error}"),
                    true,
                ),
            };
            if let Ok(mut logs) = logs.lock() {
                if let Err(error) = logs.push(line) {
                    eprintln!("could not persist Agent desktop child log: {error}");
                }
            }
            if read_failed {
                break;
            }
        }
    });
}

fn prepare_private_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let metadata = fs::symlink_metadata(directory).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("persistent log directory must be a real directory".into());
    }
    #[cfg(unix)]
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("persistent log path must not be a symbolic link".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn retry_budget_after_start(origin: StartOrigin, attempt: usize) -> bool {
    origin == StartOrigin::CrashRecovery || attempt > 0
}

fn installer_command(
    script: &Path,
    install_root: &Path,
    version: Option<&str>,
    uninstall: bool,
) -> Command {
    let mut command = Command::new("/bin/sh");
    command
        .arg(script)
        .env("MOLTNET_AGENT_HOME", install_root)
        .env_remove("MOLTNET_AGENT_ALLOW_UNVERIFIED")
        .env_remove("MOLTNET_AGENT_ALLOW_UNSIGNED");
    if let Some(version) = version {
        command.env("MOLTNET_AGENT_VERSION", version);
    }
    if uninstall {
        command.arg("--uninstall");
    }
    command
}

fn health_ready() -> Result<(), String> {
    fixed_command(
        "/usr/bin/curl",
        &[
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            HEALTH_CHECK_TIMEOUT_SECS,
            HEALTH_URL,
        ],
    )
    .map(|_| ())
}

fn fixed_command(program: &str, args: &[&str]) -> Result<Output, String> {
    const PROGRAMS: &[&str] = &["/usr/bin/curl", "/usr/bin/open"];
    if !PROGRAMS.contains(&program) {
        return Err("program is not allowlisted".into());
    }
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} failed: {error}"))?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(command_failure(program, &output))
    }
}

fn command_failure(label: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "no command output".to_string()
    };
    format!(
        "{label} failed ({}): {detail}",
        describe_exit_status(output.status)
    )
}

fn describe_exit_status(status: ExitStatus) -> String {
    if let Some(code) = status.code() {
        return format!("exit code {code}");
    }
    #[cfg(unix)]
    if let Some(signal) = status.signal() {
        return format!("signal {signal}");
    }
    "unknown exit status".to_string()
}

fn execute_update(
    version: &str,
    previous_version: &str,
    mut perform: impl FnMut(UpdateStep<'_>) -> Result<(), String>,
) -> Result<UpdateOutcome, String> {
    perform(UpdateStep::Install(version))
        .map_err(|error| format!("verified Agent CLI update failed: {error}"))?;
    let Err(update_error) = perform(UpdateStep::Start) else {
        return Ok(UpdateOutcome::Updated);
    };
    perform(UpdateStep::Install(previous_version)).map_err(|rollback_error| {
        format!("Agent CLI update failed ({update_error}); rollback failed: {rollback_error}")
    })?;
    perform(UpdateStep::Start).map_err(|restart_error| {
        format!(
            "Agent CLI update failed ({update_error}); restored {previous_version} but restart failed: {restart_error}"
        )
    })?;
    Ok(UpdateOutcome::RolledBack { update_error })
}

fn home_directory() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "HOME must be an absolute path".into())
}

fn valid_version(value: &str) -> bool {
    // Keep this stable X.Y.Z rule aligned with tools/release/sync-cli-go-mod.sh
    // and tools/release/propose-download-pin.sh.
    let pieces = value.split('.').collect::<Vec<_>>();
    pieces.len() == 3
        && pieces.iter().all(|piece| {
            !piece.is_empty()
                && (piece.len() == 1 || !piece.starts_with('0'))
                && piece.chars().all(|char| char.is_ascii_digit())
        })
}

fn parse_agent_capabilities(stdout: &[u8]) -> AgentCapabilities {
    let help = String::from_utf8_lossy(stdout);
    AgentCapabilities {
        supervised: help
            .lines()
            .any(|line| line.split_whitespace().any(|word| word == "--supervised")),
        machine_trust: help.contains("server trust --status --json"),
    }
}

fn agent_server_command(executable: &Path, capabilities: AgentCapabilities) -> Command {
    let mut command = Command::new(executable);
    command.arg("server");
    if capabilities.supervised {
        command.arg("--supervised");
    }
    command
}

fn legacy_trust_inspection_command(login_keychain: &Path) -> Command {
    let mut command = Command::new("/usr/bin/security");
    command
        .args([
            "find-certificate",
            "-a",
            "-p",
            "-c",
            "MoltNet Local Agent CA",
        ])
        .arg(login_keychain);
    command
}

fn legacy_trust_approval_command(login_keychain: &Path, local_ca: &Path) -> Command {
    let mut command = Command::new("/usr/bin/security");
    command
        .args(["add-trusted-cert", "-d", "-r", "trustRoot", "-k"])
        .arg(login_keychain)
        .arg(local_ca);
    command
}

fn legacy_trust_matches(local_ca: &str, command_succeeded: bool, certificates: &[u8]) -> bool {
    command_succeeded && String::from_utf8_lossy(certificates).contains(local_ca)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn embedded_installer_has_a_pin_and_matching_trust_anchor() {
        let expected_pin = format!(
            "RELEASE_PINNED_VERSION=\"{}\"",
            env!("MOLTNET_EMBEDDED_AGENT_CLI_VERSION")
        );
        assert!(EMBEDDED_INSTALLER.contains(&expected_pin));
        assert!(EMBEDDED_INSTALLER.contains(RELEASE_SIGNER_PUBKEY_FOR_TEST));
        assert!(!EMBEDDED_INSTALLER.contains("RELEASE_SIGNER_PUBKEY=\"\""));
    }

    const RELEASE_SIGNER_PUBKEY_FOR_TEST: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIsffodWdp+Y0UUFJq8yaFcI08nhSfxkVe4hZKhGGv5Y";

    #[test]
    fn canonical_paths_ignore_path_lookup() {
        let manager = LifecycleManager::new(PathBuf::from("/Users/test"));
        assert_eq!(
            manager.executable(),
            std::path::Path::new(
                "/Users/test/.local/share/moltnet/agent/current/bin/moltnet-agent"
            )
        );
    }

    #[test]
    fn stable_version_validation_rejects_path_and_prerelease_input() {
        assert!(valid_version("1.2.3"));
        assert!(!valid_version(""));
        assert!(!valid_version("1.2"));
        assert!(!valid_version("01.02.03"));
        assert!(!valid_version("../1.2.3"));
        assert!(!valid_version("1.2.3-beta"));
    }

    #[test]
    fn installed_agent_capabilities_are_negotiated_from_help() {
        assert_eq!(
            parse_agent_capabilities(
                b"Options:\n  --port <n>\n  --supervised\nNative supervisors use:\n  server trust --status --json\n"
            ),
            AgentCapabilities {
                supervised: true,
                machine_trust: true,
            }
        );
        assert_eq!(
            parse_agent_capabilities(
                b"Options:\n  --port <n>\nRun moltnet-agent server trust interactively.\n"
            ),
            AgentCapabilities {
                supervised: false,
                machine_trust: false,
            }
        );
        assert!(!parse_agent_capabilities(b"Use supervised operation when embedded.\n").supervised);
    }

    #[test]
    fn server_launch_arguments_follow_negotiated_supervision() {
        let executable = Path::new("/canonical/moltnet-agent");
        let legacy = agent_server_command(
            executable,
            AgentCapabilities {
                supervised: false,
                machine_trust: false,
            },
        );
        assert_eq!(legacy.get_program(), executable.as_os_str());
        assert_eq!(
            legacy.get_args().collect::<Vec<_>>(),
            [OsStr::new("server")]
        );

        let supervised = agent_server_command(
            executable,
            AgentCapabilities {
                supervised: true,
                machine_trust: true,
            },
        );
        assert_eq!(
            supervised.get_args().collect::<Vec<_>>(),
            [OsStr::new("server"), OsStr::new("--supervised")]
        );
    }

    #[test]
    fn legacy_trust_commands_are_bounded_to_the_login_keychain_and_local_ca() {
        let keychain = Path::new("/Users/test/Library/Keychains/login.keychain-db");
        let local_ca = Path::new("/Users/test/.config/moltnet/tls/local-ca.pem");
        let inspect = legacy_trust_inspection_command(keychain);
        assert_eq!(inspect.get_program(), OsStr::new("/usr/bin/security"));
        assert_eq!(
            inspect.get_args().collect::<Vec<_>>(),
            [
                OsStr::new("find-certificate"),
                OsStr::new("-a"),
                OsStr::new("-p"),
                OsStr::new("-c"),
                OsStr::new("MoltNet Local Agent CA"),
                keychain.as_os_str(),
            ]
        );

        let approve = legacy_trust_approval_command(keychain, local_ca);
        assert_eq!(approve.get_program(), OsStr::new("/usr/bin/security"));
        assert_eq!(
            approve.get_args().collect::<Vec<_>>(),
            [
                OsStr::new("add-trusted-cert"),
                OsStr::new("-d"),
                OsStr::new("-r"),
                OsStr::new("trustRoot"),
                OsStr::new("-k"),
                keychain.as_os_str(),
                local_ca.as_os_str(),
            ]
        );
    }

    #[test]
    fn legacy_trust_requires_success_and_the_exact_local_ca() {
        let local_ca = "-----BEGIN CERTIFICATE-----\nlocal\n-----END CERTIFICATE-----";
        assert!(legacy_trust_matches(
            local_ca,
            true,
            format!("other\n{local_ca}\n").as_bytes()
        ));
        assert!(!legacy_trust_matches(local_ca, false, local_ca.as_bytes()));
        assert!(!legacy_trust_matches(
            local_ca,
            true,
            b"different certificate"
        ));
    }

    #[test]
    fn failed_update_restores_previous_version_and_restarts_it() {
        let mut steps = Vec::new();
        let mut starts = 0;

        let outcome = execute_update("2.0.0", "1.0.0", |step| match step {
            UpdateStep::Install(version) => {
                steps.push(format!("install:{version}"));
                Ok(())
            }
            UpdateStep::Start => {
                starts += 1;
                steps.push(format!("start:{starts}"));
                if starts == 1 {
                    Err("readiness failed".into())
                } else {
                    Ok(())
                }
            }
        })
        .expect("rollback should recover the previous version");

        assert_eq!(
            outcome,
            UpdateOutcome::RolledBack {
                update_error: "readiness failed".into()
            }
        );
        assert_eq!(
            steps,
            ["install:2.0.0", "start:1", "install:1.0.0", "start:2"]
        );
    }

    #[test]
    fn update_failure_paths_preserve_actionable_diagnostics() {
        let initial =
            execute_update("2.0.0", "1.0.0", |_| Err("download failed".into())).unwrap_err();
        assert_eq!(initial, "verified Agent CLI update failed: download failed");

        let mut step = 0;
        let rollback = execute_update("2.0.0", "1.0.0", |_| {
            step += 1;
            match step {
                1 => Ok(()),
                2 => Err("readiness failed".into()),
                3 => Err("restore failed".into()),
                _ => unreachable!(),
            }
        })
        .unwrap_err();
        assert_eq!(
            rollback,
            "Agent CLI update failed (readiness failed); rollback failed: restore failed"
        );

        let mut step = 0;
        let restart = execute_update("2.0.0", "1.0.0", |_| {
            step += 1;
            match step {
                1 | 3 => Ok(()),
                2 => Err("readiness failed".into()),
                4 => Err("restart failed".into()),
                _ => unreachable!(),
            }
        })
        .unwrap_err();
        assert_eq!(
            restart,
            "Agent CLI update failed (readiness failed); restored 1.0.0 but restart failed: restart failed"
        );
    }

    fn manager_with_update() -> (tempfile::TempDir, LifecycleManager) {
        let home = tempfile::tempdir().unwrap();
        let mut manager = LifecycleManager::new(home.path().to_path_buf());
        manager.status.installed_version = Some("1.0.0".into());
        manager.status.available_version = Some("2.0.0".into());
        manager.status.state = LifecycleState::UpdateAvailable;
        (home, manager)
    }

    #[test]
    fn install_update_applies_successful_state_and_version_transitions() {
        let (_home, mut manager) = manager_with_update();

        let status = manager
            .install_update_with(|manager, step| match step {
                UpdateStep::Install(version) => {
                    manager.status.installed_version = Some(version.into());
                    Ok(())
                }
                UpdateStep::Start => {
                    manager.set_state(LifecycleState::Running, "ready");
                    Ok(())
                }
            })
            .unwrap();

        assert_eq!(status.state, LifecycleState::Running);
        assert_eq!(status.installed_version.as_deref(), Some("2.0.0"));
        assert_eq!(status.available_version, None);
    }

    #[test]
    fn install_update_restores_state_and_versions_after_readiness_failure() {
        let (_home, mut manager) = manager_with_update();
        let mut starts = 0;

        let error = manager
            .install_update_with(|manager, step| match step {
                UpdateStep::Install(version) => {
                    manager.status.installed_version = Some(version.into());
                    Ok(())
                }
                UpdateStep::Start => {
                    starts += 1;
                    if starts == 1 {
                        Err("readiness failed".into())
                    } else {
                        manager.set_state(LifecycleState::Running, "ready");
                        Ok(())
                    }
                }
            })
            .unwrap_err();

        let status = manager.snapshot();
        assert!(error.contains("restored 1.0.0"));
        assert_eq!(status.state, LifecycleState::UpdateAvailable);
        assert_eq!(status.installed_version.as_deref(), Some("1.0.0"));
        assert_eq!(status.available_version.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn install_update_enters_failed_state_when_rollback_cannot_finish() {
        let (_home, mut manager) = manager_with_update();
        let mut starts = 0;

        let error = manager
            .install_update_with(|manager, step| match step {
                UpdateStep::Install("1.0.0") => Err("restore failed".into()),
                UpdateStep::Install(version) => {
                    manager.status.installed_version = Some(version.into());
                    Ok(())
                }
                UpdateStep::Start => {
                    starts += 1;
                    Err(if starts == 1 {
                        "readiness failed".into()
                    } else {
                        "restart failed".into()
                    })
                }
            })
            .unwrap_err();

        assert!(error.contains("rollback failed: restore failed"));
        assert_eq!(manager.status.state, LifecycleState::Failed);
    }

    #[test]
    fn installer_command_removes_development_trust_bypasses() {
        let command = installer_command(
            Path::new("/tmp/installer.sh"),
            Path::new("/tmp/agent"),
            Some("1.2.3"),
            false,
        );

        for variable in [
            "MOLTNET_AGENT_ALLOW_UNVERIFIED",
            "MOLTNET_AGENT_ALLOW_UNSIGNED",
        ] {
            assert!(command
                .get_envs()
                .any(|(key, value)| key == OsStr::new(variable) && value.is_none()));
        }
    }

    #[test]
    fn crash_recovery_consumes_exactly_one_retry_budget() {
        let home = tempfile::tempdir().unwrap();
        let mut manager = LifecycleManager::new(home.path().to_path_buf());
        manager.child = Some(
            Command::new("/bin/sh")
                .args(["-c", "exit 7"])
                .spawn()
                .unwrap(),
        );

        assert_eq!(wait_for_exit_action(&mut manager), ExitAction::Retry);
        assert!(manager.retry_used);
        assert_eq!(manager.status.state, LifecycleState::Starting);
        assert!(retry_budget_after_start(StartOrigin::CrashRecovery, 0));

        manager.child = Some(
            Command::new("/bin/sh")
                .args(["-c", "exit 8"])
                .spawn()
                .unwrap(),
        );

        assert_eq!(wait_for_exit_action(&mut manager), ExitAction::Failed);
        assert_eq!(manager.status.state, LifecycleState::Failed);
    }

    #[test]
    fn queued_crash_recovery_is_superseded_by_a_newer_lifecycle_state() {
        let home = tempfile::tempdir().unwrap();
        let mut manager = LifecycleManager::new(home.path().to_path_buf());
        manager.retry_used = true;
        manager.status.state = LifecycleState::Removed;

        let status = manager.retry_after_exit().unwrap();

        assert_eq!(status.state, LifecycleState::Removed);
        assert!(manager.child.is_none());
    }

    fn wait_for_exit_action(manager: &mut LifecycleManager) -> ExitAction {
        for _ in 0..20 {
            let action = manager.inspect_exit();
            if action != ExitAction::None {
                return action;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("child did not exit in time");
    }

    #[test]
    fn supervisor_messages_are_persisted_for_post_mortem_debugging() {
        let home = tempfile::tempdir().unwrap();
        let manager = LifecycleManager::new(home.path().to_path_buf());

        manager.push_log("Agent Server retry scheduled");

        let log = fs::read_to_string(
            home.path()
                .join(".config/moltnet/agent-server/logs/desktop-supervisor.log"),
        )
        .unwrap();
        assert!(log.ends_with("] Agent Server retry scheduled\n"));
        #[cfg(unix)]
        {
            let directory_mode =
                fs::metadata(home.path().join(".config/moltnet/agent-server/logs"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777;
            let file_mode = fs::metadata(
                home.path()
                    .join(".config/moltnet/agent-server/logs/desktop-supervisor.log"),
            )
            .unwrap()
            .permissions()
            .mode()
                & 0o777;
            assert_eq!(directory_mode, 0o700);
            assert_eq!(file_mode, 0o600);
        }
    }

    #[cfg(unix)]
    #[test]
    fn persistent_log_refuses_symbolic_link_targets() {
        use std::os::unix::fs::symlink;

        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join(".config/moltnet/agent-server/logs");
        fs::create_dir_all(&directory).unwrap();
        let target = home.path().join("unrelated.txt");
        fs::write(&target, "unchanged").unwrap();
        symlink(&target, directory.join("desktop-supervisor.log")).unwrap();
        let manager = LifecycleManager::new(home.path().to_path_buf());

        manager.push_log("must not follow the link");

        assert_eq!(fs::read_to_string(target).unwrap(), "unchanged");
        assert_eq!(manager.snapshot().logs, ["must not follow the link"]);
    }

    #[test]
    fn stopped_children_reach_a_terminal_state() {
        let home = tempfile::tempdir().unwrap();
        let mut manager = LifecycleManager::new(home.path().to_path_buf());
        manager.child = Some(
            Command::new("/bin/sh")
                .args(["-c", "sleep 60"])
                .spawn()
                .unwrap(),
        );

        let status = manager.stop_server().unwrap();

        assert_eq!(status.state, LifecycleState::Stopped);
        assert_eq!(status.message, "The Agent Server is stopped.");
    }

    #[test]
    fn lifecycle_states_are_machine_readable() {
        assert_eq!(
            serde_json::to_string(&LifecycleState::NeedsTrust).unwrap(),
            "\"needs_trust\""
        );
        assert_eq!(
            serde_json::to_string(&LifecycleState::UpdateAvailable).unwrap(),
            "\"update_available\""
        );
    }
}
