use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const CONSOLE_URL: &str = "https://console.themolt.net/runtime/local";
const HEALTH_URL: &str = "https://127.0.0.1:17374/health";
const MAX_LOG_LINES: usize = 400;
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
        if update.update_available {
            self.set_state(
                LifecycleState::UpdateAvailable,
                &format!(
                    "Agent {} is ready to install after consent.",
                    update.latest_version.unwrap_or_else(|| "update".into())
                ),
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
        let previous_version = self.status.installed_version.clone();
        self.stop_server()?;
        self.set_state(
            LifecycleState::Installing,
            &format!("Installing verified agent {version}…"),
        );
        if let Err(error) = self.run_installer(Some(&version), false) {
            return self.fail(&format!("verified Agent CLI update failed: {error}"));
        }
        self.refresh_installed_version();
        self.status.available_version = None;
        self.retry_used = false;
        match self.start_server() {
            Ok(status) => Ok(status),
            Err(update_error) => {
                self.push_log("Updated server failed readiness; rolling back Agent CLI.");
                let Some(previous_version) = previous_version else {
                    return self.fail(&format!(
                        "Agent CLI update failed readiness and no rollback version was available: {update_error}"
                    ));
                };
                if let Err(rollback_error) = self.run_installer(Some(&previous_version), false) {
                    return self.fail(&format!(
                        "Agent CLI update failed ({update_error}); rollback failed: {rollback_error}"
                    ));
                }
                self.refresh_installed_version();
                self.push_log(&format!(
                    "Rolled back to Agent CLI {previous_version}; restarting."
                ));
                self.retry_used = false;
                self.start_server()
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
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
                Ok(None) => {
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
        Ok(self.snapshot())
    }

    pub fn inspect_exit(&mut self) -> bool {
        let exited = self
            .child
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten())
            .is_some();
        if exited {
            self.child = None;
            if !self.retry_used {
                self.retry_used = true;
                self.push_log("Agent Server exited unexpectedly; retrying once.");
                if self.start_server().is_ok() {
                    self.retry_used = true;
                    return true;
                }
                return true;
            }
            self.set_state(
                LifecycleState::Failed,
                "The Agent Server exited unexpectedly. Use Retry after reviewing logs.",
            );
        }
        exited
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
        if self.child.is_none() && health_ready() {
            return self.fail(
                "Another process already owns the local Agent Server. It was left untouched.",
            );
        }
        self.set_state(
            LifecycleState::Starting,
            "Starting the supervised Agent Server…",
        );

        for attempt in 0..=1 {
            let mut child = Command::new(self.executable())
                .args(["server", "--supervised"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("could not start Agent Server: {error}"))?;
            if let Some(stdout) = child.stdout.take() {
                capture_lines(stdout, Arc::clone(&self.logs));
            }
            if let Some(stderr) = child.stderr.take() {
                capture_lines(stderr, Arc::clone(&self.logs));
            }
            let deadline = Instant::now() + START_TIMEOUT;
            loop {
                if health_ready() {
                    self.child = Some(child);
                    self.retry_used = attempt > 0;
                    self.set_state(
                        LifecycleState::Running,
                        "Ready. Open Console to pair this server process.",
                    );
                    return Ok(self.snapshot());
                }
                if child
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .is_some()
                {
                    if attempt == 0 {
                        self.push_log("Agent Server exited before readiness; retrying once.");
                        break;
                    }
                    return self.fail("Agent Server exited before readiness twice");
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return self.fail("Agent Server did not become ready within 12 seconds");
                }
                thread::sleep(Duration::from_millis(200));
            }
        }
        self.fail("Agent Server failed to start")
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

    fn run_agent(&self, args: &[&str]) -> Result<std::process::Output, String> {
        let output = Command::new(self.executable())
            .args(args)
            .output()
            .map_err(|error| format!("agent command failed: {error}"))?;
        if output.status.success() {
            Ok(output)
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
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
            .env("MOLTNET_AGENT_HOME", self.install_root());
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
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
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

fn health_ready() -> bool {
    fixed_command(
        "/usr/bin/curl",
        &[
            "--insecure",
            "--silent",
            "--fail",
            "--max-time",
            "1",
            HEALTH_URL,
        ],
    )
    .is_ok()
}

fn fixed_command(program: &str, args: &[&str]) -> Result<std::process::Output, String> {
    const PROGRAMS: &[&str] = &["/usr/bin/curl", "/usr/bin/open"];
    if !PROGRAMS.contains(&program) {
        return Err("program is not allowlisted".into());
    }
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} failed: {error}"))?;
    output
        .status
        .success()
        .then_some(output)
        .ok_or_else(|| format!("{program} exited unsuccessfully"))
}

fn home_directory() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "HOME must be an absolute path".into())
}

fn valid_version(value: &str) -> bool {
    let mut pieces = value.split('.');
    pieces.clone().count() == 3
        && pieces.all(|piece| !piece.is_empty() && piece.chars().all(|char| char.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_installer_has_a_pin_and_matching_trust_anchor() {
        assert!(EMBEDDED_INSTALLER.contains("RELEASE_PINNED_VERSION=\"0.56.2\""));
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
        assert!(!valid_version("../1.2.3"));
        assert!(!valid_version("1.2.3-beta"));
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
