use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, ExitStatus, Output, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const CONSOLE_URL: &str = "https://console.themolt.net/runtime/local";
const HEALTH_URL: &str = "https://127.0.0.1:17374/health";
const MAX_LOG_LINES: usize = 400;
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

#[derive(Clone, Debug, Default, Serialize)]
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
    supported: bool,
    trusted: bool,
    fingerprint: Option<String>,
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

pub struct LifecycleManager {
    status: DesktopStatus,
    child: Option<Child>,
    logs: Arc<Mutex<VecDeque<String>>>,
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
        Self {
            status: DesktopStatus {
                state: LifecycleState::Checking,
                message: "Checking the local agent bundle…".into(),
                ..DesktopStatus::default()
            },
            child: None,
            logs: Arc::new(Mutex::new(VecDeque::new())),
            retry_used: false,
            home,
        }
    }

    pub fn snapshot(&self) -> DesktopStatus {
        let mut status = self.status.clone();
        status.logs = self
            .logs
            .lock()
            .map(|logs| logs.iter().cloned().collect())
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
        let trust = self.trust_status()?;
        self.apply_trust(&trust);
        if !trust.supported || !trust.trusted {
            self.set_state(
                LifecycleState::NeedsTrust,
                "Approve the per-user local CA before the Agent Server starts.",
            );
            return Ok(self.snapshot());
        }
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
        let trust = self.trust_status()?;
        self.apply_trust(&trust);
        if trust.trusted {
            self.start_server()
        } else {
            self.set_state(
                LifecycleState::NeedsTrust,
                "The verified bundle is installed. Local HTTPS trust needs consent.",
            );
            Ok(self.snapshot())
        }
    }

    pub fn approve_trust(&mut self) -> Result<DesktopStatus, String> {
        let output = self.run_agent(&["server", "trust", "--yes", "--json"])?;
        let trust: TrustResult = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("invalid trust response: {error}"))?;
        if !trust.supported || !trust.trusted {
            return self.fail("macOS did not report the local CA as trusted");
        }
        self.apply_trust(&trust);
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
        let outcome = execute_update(&version, &previous_version, |step| match step {
            UpdateStep::Install(target) => {
                self.run_installer(Some(target), false)?;
                self.refresh_installed_version();
                Ok(())
            }
            UpdateStep::Start => {
                self.retry_used = false;
                self.start_server().map(|_| ())
            }
        })
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
            self.run_agent(&["server", "trust", "--remove", "--yes", "--json"])?;
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
        let output = self.run_agent(&["server", "trust", "--remove", "--yes", "--json"])?;
        let trust: TrustResult = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("invalid trust removal response: {error}"))?;
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
        self.start_server()
    }

    pub fn open_console(&self) -> Result<(), String> {
        fixed_command("/usr/bin/open", &[CONSOLE_URL]).map(|_| ())
    }

    pub fn open_logs(&self) -> Result<(), String> {
        fs::create_dir_all(self.logs_directory()).map_err(|error| error.to_string())?;
        let path = self.logs_directory().to_string_lossy().into_owned();
        fixed_command("/usr/bin/open", &[&path]).map(|_| ())
    }

    fn start_server(&mut self) -> Result<DesktopStatus, String> {
        self.require_installed()?;
        if self.child.is_none() && health_ready().is_ok() {
            return self.fail(
                "Another process already owns the local Agent Server. It was left untouched.",
            );
        }
        self.set_state(
            LifecycleState::Starting,
            "Starting the supervised Agent Server…",
        );

        let mut last_failure = "Agent Server failed to start".to_string();
        for attempt in 0..MAX_START_ATTEMPTS {
            let mut child = match Command::new(self.executable())
                .args(["server", "--supervised"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(error) => return self.fail(&format!("could not start Agent Server: {error}")),
            };
            if let Some(stdout) = child.stdout.take() {
                capture_lines(stdout, Arc::clone(&self.logs));
            }
            if let Some(stderr) = child.stderr.take() {
                capture_lines(stderr, Arc::clone(&self.logs));
            }
            let deadline = Instant::now() + START_TIMEOUT;
            loop {
                let health_error = match health_ready() {
                    Ok(()) => {
                        self.child = Some(child);
                        self.retry_used = attempt > 0;
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

    fn trust_status(&self) -> Result<TrustResult, String> {
        let output = self.run_agent(&["server", "trust", "--status", "--json"])?;
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("invalid trust status response: {error}"))
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
        let mut command = Command::new("/bin/sh");
        command
            .arg(script.path())
            .env("MOLTNET_AGENT_HOME", self.install_root())
            .env_remove("MOLTNET_AGENT_ALLOW_UNVERIFIED")
            .env_remove("MOLTNET_AGENT_ALLOW_UNSIGNED");
        if let Some(version) = version {
            command.env("MOLTNET_AGENT_VERSION", version);
        }
        if uninstall {
            command.arg("--uninstall");
        }
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
        push_bounded(&self.logs, line.to_string());
        if let Err(error) = self.persist_log(line) {
            eprintln!("could not persist Agent desktop supervisor log: {error}");
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

    fn persist_log(&self, line: &str) -> Result<(), String> {
        let directory = self.logs_directory();
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(directory.join("desktop-supervisor.log"))
            .map_err(|error| error.to_string())?;
        writeln!(file, "{line}").map_err(|error| error.to_string())
    }
}

fn capture_lines(reader: impl std::io::Read + Send + 'static, logs: Arc<Mutex<VecDeque<String>>>) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            push_bounded(&logs, line);
        }
    });
}

fn push_bounded(logs: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut logs) = logs.lock() {
        logs.push_back(line);
        while logs.len() > MAX_LOG_LINES {
            logs.pop_front();
        }
    }
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
        && pieces
            .iter()
            .all(|piece| !piece.is_empty() && piece.chars().all(|char| char.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(!valid_version("../1.2.3"));
        assert!(!valid_version("1.2.3-beta"));
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
    fn supervisor_messages_are_persisted_for_post_mortem_debugging() {
        let home = tempfile::tempdir().unwrap();
        let manager = LifecycleManager::new(home.path().to_path_buf());

        manager.push_log("Agent Server retry scheduled");

        let log = fs::read_to_string(
            home.path()
                .join(".config/moltnet/agent-server/logs/desktop-supervisor.log"),
        )
        .unwrap();
        assert_eq!(log, "Agent Server retry scheduled\n");
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
