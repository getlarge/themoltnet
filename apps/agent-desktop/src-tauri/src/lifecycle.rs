use crate::build_support::{valid_version, version_at_least};
#[cfg(unix)]
use crate::control::{NativeConnection, NativeToken, NATIVE_TOKEN_ENV};
use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::{
    collections::VecDeque,
    env,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Output, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_LOG_LINES: usize = 400;
const MAX_LOG_LINE_BYTES: usize = 16 * 1024;
const MAX_PERSISTED_LOG_BYTES: u64 = 1024 * 1024;
const MAX_START_ATTEMPTS: usize = 2;
const START_TIMEOUT: Duration = Duration::from_secs(12);
const STOP_TIMEOUT: Duration = Duration::from_secs(17);
// Keep aligned with LOCK_HELD_EXIT_CODE in agent-daemon/src/cli/server.ts.
const AGENT_SERVER_LOCK_HELD_EXIT_CODE: i32 = 75;
const EMBEDDED_AGENT_VERSION: &str = env!("MOLTNET_EMBEDDED_AGENT_CLI_VERSION");
const EMBEDDED_INSTALLER: &str = include_str!(concat!(env!("OUT_DIR"), "/install-agent.sh"));

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleState {
    #[default]
    Checking,
    NeedsInstall,
    Installing,
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
    pub message: String,
    pub logs: Arc<VecDeque<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    latest_version: Option<String>,
    update_available: bool,
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
    lines: Arc<VecDeque<String>>,
    path: PathBuf,
    file: Option<File>,
    persisted_bytes: u64,
}

impl LogBuffer {
    fn new(path: PathBuf) -> Self {
        Self {
            lines: Arc::new(VecDeque::new()),
            path,
            file: None,
            persisted_bytes: 0,
        }
    }

    fn push(&mut self, line: String) -> Result<(), String> {
        let line = truncate_log_line(&line, MAX_LOG_LINE_BYTES);
        let lines = Arc::make_mut(&mut self.lines);
        lines.push_back(line.clone());
        while lines.len() > MAX_LOG_LINES {
            lines.pop_front();
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
    /// Grant for the server process currently running, if any. Regenerated on
    /// every spawn and dropped when the child stops, so it is scoped to one
    /// process exactly as the server's own grant map is.
    control_connection: Option<NativeConnection>,
}

impl LifecycleManager {
    /// The grant for the running server, if one is running.
    pub fn control_connection(&self) -> Option<&NativeConnection> {
        self.child.as_ref().and(self.control_connection.as_ref())
    }
}

impl Default for LifecycleManager {
    fn default() -> Self {
        Self::new(home_directory().expect("HOME is required"))
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
            control_connection: None,
        }
    }

    pub fn snapshot(&self) -> DesktopStatus {
        let mut status = self.status.clone();
        status.logs = self
            .logs
            .lock()
            .map(|logs| Arc::clone(&logs.lines))
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
        self.ensure_supported_agent()?;
        self.start_server()
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
        self.require_supported_version()?;
        self.start_server()
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
                        "Agent CLI {version} could not be activated. Version {previous_version} was restored."
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

    pub fn remove_bundle(&mut self) -> Result<DesktopStatus, String> {
        self.stop_server()?;
        self.run_installer(None, true)?;
        self.status.installed_version = None;
        self.status.available_version = None;
        self.set_state(
            LifecycleState::Removed,
            "The agent bundle was removed. ~/.config/moltnet was preserved.",
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
        if let Some(connection) = self.control_connection.take() {
            connection.deactivate();
        }
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
        let status = match self.child.as_mut().map(Child::try_wait) {
            Some(Ok(status)) => status,
            Some(Err(error)) => {
                let message = format!("could not observe Agent Server exit: {error}");
                self.push_log(&message);
                self.set_state(LifecycleState::Failed, &message);
                return ExitAction::Failed;
            }
            None => None,
        };
        let Some(status) = status else {
            return ExitAction::None;
        };
        self.child = None;
        if let Some(connection) = self.control_connection.take() {
            connection.deactivate();
        }
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

    pub fn start_server(&mut self) -> Result<DesktopStatus, String> {
        self.start_server_for(StartOrigin::Explicit)
    }

    fn start_server_for(&mut self, origin: StartOrigin) -> Result<DesktopStatus, String> {
        self.ensure_supported_agent()?;
        if self.child.is_some() {
            return Ok(self.snapshot());
        }
        self.set_state(LifecycleState::Starting, "Starting the Agent Server…");

        let mut last_failure = "Agent Server failed to start".to_string();
        for attempt in 0..MAX_START_ATTEMPTS {
            let token = match NativeToken::generate() {
                Ok(token) => token,
                Err(error) => return self.fail(&error),
            };
            // A short canonical path fits sockaddr_un on macOS and Linux.
            let directory = match crate::native_socket::private_directory() {
                Ok((directory, cleanup)) => {
                    if cleanup.removed > 0 || !cleanup.errors.is_empty() {
                        self.push_log(&format!(
                            "Native socket cleanup removed {} stale director{} and encountered {} error{}.",
                            cleanup.removed,
                            if cleanup.removed == 1 { "y" } else { "ies" },
                            cleanup.errors.len(),
                            if cleanup.errors.len() == 1 { "" } else { "s" },
                        ));
                    }
                    for error in cleanup.errors {
                        self.push_log(&format!("Native socket cleanup warning: {error}"));
                    }
                    Arc::new(directory)
                }
                Err(error) => {
                    return self.fail(&format!(
                        "could not prepare private control socket directory: {error}"
                    ))
                }
            };
            let mut command = agent_server_command(
                &self.executable(),
                &directory.path().join(crate::native_socket::SOCKET_NAME),
            );
            // The child consumes and unsets this, so its own run children
            // cannot inherit the desktop's control grant. Process environments
            // are readable inside the same user boundary on supported hosts;
            // the private directory plus kernel UID/PID peer check is the
            // transport boundary, while this grant prevents accidental use by
            // another client in that boundary.
            command.env(NATIVE_TOKEN_ENV, token.expose());
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
            let connection = NativeConnection::new(token, directory, child.id());
            let deadline = Instant::now() + START_TIMEOUT;
            loop {
                let health_error = match connection.health() {
                    Ok(()) => {
                        self.control_connection = Some(connection.clone());
                        self.child = Some(child);
                        self.retry_used = retry_budget_after_start(origin, attempt);
                        self.set_state(LifecycleState::Running, "Ready for local work.");
                        return Ok(self.snapshot());
                    }
                    Err(error) => error,
                };
                match child.try_wait() {
                    Ok(Some(status)) => {
                        connection.deactivate();
                        let should_retry = startup_should_retry(&status, attempt);
                        last_failure = startup_failure(status);
                        self.push_log(&last_failure);
                        if !should_retry && status.code() == Some(AGENT_SERVER_LOCK_HELD_EXIT_CODE)
                        {
                            return self.fail(&last_failure);
                        }
                        if should_retry {
                            self.push_log("Retrying Agent Server startup once.");
                        }
                        break;
                    }
                    Err(error) => {
                        connection.deactivate();
                        let _ = child.kill();
                        let _ = child.wait();
                        return self.fail(&format!(
                            "could not inspect Agent Server readiness: {error}"
                        ));
                    }
                    Ok(None) => {}
                }
                if Instant::now() >= deadline {
                    connection.deactivate();
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

    fn run_agent(&self, args: &[&str]) -> Result<Output, String> {
        let output = host_command(&self.executable())
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
        let mut command = installer_command(
            script.path(),
            &self.home,
            &self.install_root(),
            version,
            uninstall,
        );
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

    fn ensure_supported_agent(&mut self) -> Result<(), String> {
        self.refresh_installed_version();
        if self
            .status
            .installed_version
            .as_deref()
            .is_some_and(|version| version_at_least(version, EMBEDDED_AGENT_VERSION))
        {
            return Ok(());
        }

        self.set_state(
            LifecycleState::Installing,
            &format!("Installing Agent CLI {EMBEDDED_AGENT_VERSION}…"),
        );
        self.push_log(&format!(
            "Installed Agent CLI predates the embedded {EMBEDDED_AGENT_VERSION} desktop contract; running the verified installer."
        ));
        if let Err(error) = self.run_installer(None, false) {
            return self.fail(&format!("verified Agent CLI upgrade failed: {error}"));
        }
        self.refresh_installed_version();
        self.require_supported_version()
    }

    fn require_supported_version(&mut self) -> Result<(), String> {
        let installed_version = self.status.installed_version.as_deref().ok_or_else(|| {
            "the installed Agent CLI version is unavailable; reinstall before continuing"
                .to_string()
        })?;
        if version_at_least(installed_version, EMBEDDED_AGENT_VERSION) {
            Ok(())
        } else {
            self.fail(&format!(
                "Agent CLI {installed_version} is incompatible; the verified {EMBEDDED_AGENT_VERSION} bundle is required"
            ))
        }
    }

    fn require_installed(&self) -> Result<(), String> {
        self.executable()
            .is_file()
            .then_some(())
            .ok_or_else(|| "the canonical MoltNet agent bundle is not installed".into())
    }

    fn set_state(&mut self, state: LifecycleState, message: &str) {
        if self.status.state != state {
            eprintln!(
                "agent-desktop lifecycle {:?} -> {:?}",
                self.status.state, state
            );
        }
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

    pub fn logs_directory(&self) -> PathBuf {
        self.home.join(".config/moltnet/agent-server/logs")
    }
}

pub fn open_logs(directory: &Path) -> Result<(), String> {
    prepare_private_directory(directory)?;
    let path = directory.to_string_lossy().into_owned();
    fixed_command(platform_opener(), &[&path]).map(|_| ())
}

fn capture_lines(
    reader: impl std::io::Read + Send + 'static,
    logs: Arc<Mutex<LogBuffer>>,
    attempt: usize,
    stream: &'static str,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        loop {
            let (line, read_failed) = match read_bounded_line(&mut reader, MAX_LOG_LINE_BYTES) {
                Ok(Some(line)) => (
                    format!("Agent Server {stream} [attempt {attempt}]: {line}"),
                    false,
                ),
                Ok(None) => break,
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

fn read_bounded_line(
    reader: &mut impl BufRead,
    max_bytes: usize,
) -> std::io::Result<Option<String>> {
    let mut bytes = Vec::with_capacity(max_bytes.min(1024));
    let mut truncated = false;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            if bytes.is_empty() && !truncated {
                return Ok(None);
            }
            break;
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let content_len = newline.unwrap_or(buffer.len());
        let remaining = max_bytes.saturating_sub(bytes.len());
        let copied = content_len.min(remaining);
        bytes.extend_from_slice(&buffer[..copied]);
        truncated |= copied < content_len;
        reader.consume(content_len + usize::from(newline.is_some()));
        if newline.is_some() {
            break;
        }
    }
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    let line = String::from_utf8_lossy(&bytes);
    Ok(Some(if truncated {
        format!("{} … [truncated]", line.trim_end())
    } else {
        line.into_owned()
    }))
}

fn truncate_log_line(line: &str, max_bytes: usize) -> String {
    const MARKER: &str = " … [truncated]";
    if line.len() <= max_bytes {
        return line.to_string();
    }
    let limit = max_bytes.saturating_sub(MARKER.len());
    let mut boundary = limit;
    while boundary > 0 && !line.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}{MARKER}", line[..boundary].trim_end())
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
    home: &Path,
    install_root: &Path,
    version: Option<&str>,
    uninstall: bool,
) -> Command {
    let mut command = Command::new("/bin/sh");
    command
        .arg(script)
        .env_clear()
        .env("HOME", home)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("MOLTNET_AGENT_HOME", install_root);
    if let Some(version) = version {
        command.env("MOLTNET_AGENT_VERSION", version);
    }
    if uninstall {
        command.arg("--uninstall");
    }
    command
}

fn platform_opener() -> &'static str {
    if cfg!(target_os = "macos") {
        "/usr/bin/open"
    } else {
        "/usr/bin/xdg-open"
    }
}

fn fixed_command(program: &str, args: &[&str]) -> Result<Output, String> {
    const PROGRAMS: &[&str] = &["/usr/bin/open", "/usr/bin/xdg-open"];
    if !PROGRAMS.contains(&program) {
        return Err("program is not allowlisted".into());
    }
    // xdg-open is a shell script, so give it only system helper locations;
    // the Agent Server itself keeps the user's PATH for worker tools.
    let mut command = host_command(Path::new(program));
    command.env("PATH", "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    let output = command
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

fn startup_failure(status: ExitStatus) -> String {
    if status.code() == Some(AGENT_SERVER_LOCK_HELD_EXIT_CODE) {
        return "Another Agent Server is already using this data directory. Stop it before retrying."
            .to_string();
    }
    format!(
        "Agent Server exited before readiness ({}). Review the bounded server logs for the startup error.",
        describe_exit_status(status)
    )
}

fn startup_should_retry(status: &ExitStatus, attempt: usize) -> bool {
    status.code() != Some(AGENT_SERVER_LOCK_HELD_EXIT_CODE) && attempt + 1 < MAX_START_ATTEMPTS
}

fn execute_update(
    version: &str,
    previous_version: &str,
    mut perform: impl FnMut(UpdateStep<'_>) -> Result<(), String>,
) -> Result<UpdateOutcome, String> {
    let update_error = match perform(UpdateStep::Install(version)) {
        Ok(()) => match perform(UpdateStep::Start) {
            Ok(()) => return Ok(UpdateOutcome::Updated),
            Err(error) => error,
        },
        Err(error) => format!("verified Agent CLI update failed: {error}"),
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

fn agent_server_command(executable: &Path, socket: &Path) -> Command {
    let mut command = host_command(executable);
    command
        .args(["server", "--supervised", "--native-socket"])
        .arg(socket);
    command
}

/// Strip AppImage loader/module overrides before starting host programs. They
/// point inside the mounted image and can make an otherwise valid system
/// binary load incompatible libraries. PATH and product configuration remain
/// inherited so managed runs can still find the operator's installed tools.
fn host_command(program: &Path) -> Command {
    const APPIMAGE_ENV: &[&str] = &[
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "GTK_PATH",
        "GIO_MODULE_DIR",
        "GDK_PIXBUF_MODULE_FILE",
        "PYTHONHOME",
        "PYTHONPATH",
    ];
    let mut command = Command::new(program);
    for variable in APPIMAGE_ENV {
        command.env_remove(variable);
    }
    if let (Some(path), Some(appdir)) = (env::var_os("PATH"), env::var_os("APPDIR")) {
        if let Some(path) = path_without_directory(&path, Path::new(&appdir)) {
            command.env("PATH", path);
        }
    }
    command
}

fn path_without_directory(path: &OsStr, directory: &Path) -> Option<OsString> {
    env::join_paths(env::split_paths(path).filter(|entry| !entry.starts_with(directory))).ok()
}

/// Open a provider sign-in page in the operator's browser.
///
/// The URL arrives from the local Agent Server, which got it from the
/// provider's device-authorization endpoint. It is still untrusted input to
/// `open`, which would happily launch a `file://` path or a custom-scheme
/// handler, so only https is accepted.
pub fn open_verification_url(url: &str) -> Result<(), String> {
    if !is_https_url(url) {
        return Err("the sign-in page must be a secure https address".into());
    }
    fixed_command(platform_opener(), &[url]).map(|_| ())
}

fn is_https_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    // A host is required, and neither whitespace nor a NUL may reach `open`.
    !rest.is_empty()
        && !rest.starts_with('/')
        && !rest.contains(char::is_whitespace)
        && !rest.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_failure_identifies_an_existing_server_lock() {
        let held = ExitStatus::from_raw(AGENT_SERVER_LOCK_HELD_EXIT_CODE << 8);
        let other = ExitStatus::from_raw(1 << 8);

        assert_eq!(
            startup_failure(held),
            "Another Agent Server is already using this data directory. Stop it before retrying."
        );
        assert!(startup_failure(other).contains("Review the bounded server logs"));
        assert!(!startup_should_retry(&held, 0));
        assert!(startup_should_retry(&other, 0));
        assert!(!startup_should_retry(&other, MAX_START_ATTEMPTS - 1));
    }

    #[test]
    fn only_https_sign_in_pages_may_be_opened() {
        // `open` launches whatever a scheme is registered to, so a URL the
        // server relays from a provider must not reach it unchecked.
        assert!(is_https_url("https://console.anthropic.com/device"));
        assert!(!is_https_url("http://example.test/device"));
        assert!(!is_https_url("file:///etc/passwd"));
        assert!(!is_https_url("x-evil://run"));
        assert!(!is_https_url("https://"));
        assert!(!is_https_url("https:///etc/passwd"));
        assert!(!is_https_url("https://host /extra"));
    }

    #[test]
    fn refuses_to_open_a_non_https_sign_in_page() {
        assert!(open_verification_url("file:///etc/passwd").is_err());
    }

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
    fn installed_agent_version_must_satisfy_the_embedded_contract() {
        assert!(version_at_least("0.58.0", "0.58.0"));
        assert!(version_at_least("0.59.0", "0.58.0"));
        assert!(version_at_least("1.0.0", "0.58.0"));
        assert!(!version_at_least("0.57.9", "0.58.0"));
        assert!(!version_at_least("invalid", "0.58.0"));
        assert!(!version_at_least("0.58.0", "invalid"));
    }

    #[test]
    fn server_launch_always_uses_supervised_contract() {
        let executable = Path::new("/canonical/moltnet-agent");
        let socket = Path::new("/tmp/private/control.sock");
        let command = agent_server_command(executable, socket);
        assert_eq!(command.get_program(), executable.as_os_str());
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [
                OsStr::new("server"),
                OsStr::new("--supervised"),
                OsStr::new("--native-socket"),
                socket.as_os_str(),
            ]
        );
        assert!(command
            .get_envs()
            .all(|(key, value)| key != OsStr::new("PATH") || value.is_none()));
    }

    #[test]
    fn appimage_directory_is_removed_without_dropping_user_tools() {
        let path = OsStr::new("/tmp/App/usr/bin:/opt/homebrew/bin:/usr/bin");
        assert_eq!(
            path_without_directory(path, Path::new("/tmp/App")),
            Some(OsString::from("/opt/homebrew/bin:/usr/bin"))
        );
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
        let mut step = 0;
        let initial = execute_update("2.0.0", "1.0.0", |_| {
            step += 1;
            match step {
                1 => Err("download failed".into()),
                2 | 3 => Ok(()),
                _ => unreachable!(),
            }
        })
        .unwrap();
        assert_eq!(
            initial,
            UpdateOutcome::RolledBack {
                update_error: "verified Agent CLI update failed: download failed".into()
            }
        );

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
    fn installer_command_uses_only_the_desktop_environment() {
        let command = installer_command(
            Path::new("/tmp/installer.sh"),
            Path::new("/Users/test"),
            Path::new("/tmp/agent"),
            Some("1.2.3"),
            false,
        );

        let environment = command
            .get_envs()
            .map(|(key, value)| (key, value.unwrap()))
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(environment.len(), 4);
        assert_eq!(
            environment.get(OsStr::new("HOME")).copied(),
            Some(OsStr::new("/Users/test"))
        );
        assert_eq!(
            environment.get(OsStr::new("PATH")).copied(),
            Some(OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin"))
        );
        assert_eq!(
            environment
                .get(OsStr::new("MOLTNET_AGENT_VERSION"))
                .copied(),
            Some(OsStr::new("1.2.3"))
        );
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

    #[test]
    fn oversized_log_lines_are_bounded_before_persistence() {
        let home = tempfile::tempdir().unwrap();
        let manager = LifecycleManager::new(home.path().to_path_buf());

        manager.push_log(&"x".repeat(MAX_PERSISTED_LOG_BYTES as usize + 1));

        let status = manager.snapshot();
        assert_eq!(status.logs.len(), 1);
        assert!(status.logs[0].len() <= MAX_LOG_LINE_BYTES);
        assert!(status.logs[0].ends_with(" … [truncated]"));
        let persisted = fs::metadata(
            home.path()
                .join(".config/moltnet/agent-server/logs/desktop-supervisor.log"),
        )
        .unwrap()
        .len();
        assert!(persisted <= MAX_PERSISTED_LOG_BYTES);
    }

    #[test]
    fn bounded_reader_drains_the_rest_of_an_oversized_line() {
        let input = format!("{}\nnext\n", "x".repeat(64));
        let mut reader = BufReader::new(input.as_bytes());

        let first = read_bounded_line(&mut reader, 16).unwrap().unwrap();
        let second = read_bounded_line(&mut reader, 16).unwrap().unwrap();

        assert!(first.ends_with(" … [truncated]"));
        assert_eq!(second, "next");
        assert_eq!(read_bounded_line(&mut reader, 16).unwrap(), None);
    }

    #[test]
    fn persistent_log_rotates_before_crossing_its_limit() {
        let home = tempfile::tempdir().unwrap();
        let path = home
            .path()
            .join(".config/moltnet/agent-server/logs/desktop-supervisor.log");
        prepare_private_directory(path.parent().unwrap()).unwrap();
        fs::write(&path, vec![b'x'; MAX_PERSISTED_LOG_BYTES as usize]).unwrap();
        let mut logs = LogBuffer::new(path.clone());

        logs.push("second".into()).unwrap();

        assert!(path.with_extension("log.1").is_file());
        assert!(fs::read_to_string(path).unwrap().ends_with("] second\n"));
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
        assert_eq!(
            manager.snapshot().logs.front().map(String::as_str),
            Some("must not follow the link")
        );
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
            serde_json::to_string(&LifecycleState::Starting).unwrap(),
            "\"starting\""
        );
        assert_eq!(
            serde_json::to_string(&LifecycleState::UpdateAvailable).unwrap(),
            "\"update_available\""
        );
    }
}
