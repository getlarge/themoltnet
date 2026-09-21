//! Read-only Linux readiness and narrowly defined, explicitly requested repairs.
use crate::lifecycle::host_command;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Mutex, TryLockError};

static REPAIR: Mutex<()> = Mutex::new(());
const QEMU_PACKAGES: &[&str] = &["qemu-utils", "qemu-system-x86"];
const SECRET_SERVICE_PACKAGES: &[&str] = &["gnome-keyring", "libsecret-1-0", "dbus-bin"];
const APT_INSTALL_FLAGS: &[&str] = &["install", "--yes", "--no-remove", "--no-install-recommends"];
const PKEXEC_CANCELLED: i32 = 126;
const PKEXEC_DENIED: i32 = 127;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxSetup {
    pub linux: bool,
    pub distribution: String,
    pub can_install: bool,
    pub qemu_ready: bool,
    pub keyring_installed: bool,
    pub secret_service_available: bool,
    pub kvm_present: bool,
    pub kvm_accessible: bool,
    pub active_kvm_member: bool,
    pub kvm_pending_relogin: bool,
    pub can_enable_kvm: bool,
    pub install_command: String,
    pub enable_kvm_command: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Repair {
    InstallDependencies,
    EnableKvm,
}

fn ubuntu_24(release: &str) -> bool {
    let field = |name: &str| {
        release.lines().find_map(|line| {
            let (key, value) = line.split_once('=')?;
            (key == name).then(|| value.trim_matches('"'))
        })
    };
    field("ID") == Some("ubuntu") && field("VERSION_ID") == Some("24.04")
}

fn current_username() -> Option<String> {
    let output = host_command(Path::new("/usr/bin/id"))
        .arg("-un")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let username = std::str::from_utf8(&output.stdout).ok()?.trim();
    (!username.is_empty()).then(|| username.to_string())
}

fn current_groups() -> Option<String> {
    let output = host_command(Path::new("/usr/bin/id"))
        .arg("-Gn")
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn group_contains_user(groups: &str, group: &str, username: &str) -> bool {
    groups.lines().any(|line| {
        let mut fields = line.splitn(4, ':');
        fields.next() == Some(group)
            && fields
                .nth(2)
                .is_some_and(|members| members.split(',').any(|member| member == username))
    })
}

fn group_list_contains(groups: &str, group: &str) -> bool {
    groups
        .split_whitespace()
        .any(|candidate| candidate == group)
}

#[derive(Clone, Copy)]
struct KvmState {
    present: bool,
    accessible: bool,
    configured_member: bool,
    active_member: bool,
}

fn kvm_pending_relogin(state: KvmState) -> bool {
    state.present && !state.accessible && state.configured_member && !state.active_member
}

fn dbus_has_secret_service(method: &str) -> bool {
    let output = host_command(Path::new("/usr/bin/dbus-send"))
        .args([
            "--session",
            "--print-reply",
            "--reply-timeout=1000",
            "--dest=org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            method,
        ])
        .output();
    output.is_ok_and(|output| {
        output.status.success()
            && String::from_utf8_lossy(&output.stdout).contains("org.freedesktop.secrets")
    })
}

// A Secret Service may already own its bus name or be activatable on demand.
// This does not activate or unlock it, read a secret, or prompt.
fn secret_service_available() -> bool {
    Path::new("/usr/bin/dbus-send").is_file()
        && (dbus_has_secret_service("org.freedesktop.DBus.ListNames")
            || dbus_has_secret_service("org.freedesktop.DBus.ListActivatableNames"))
}

fn required_packages(
    qemu_ready: bool,
    secret_service_available: bool,
    keyring_installed: bool,
) -> Vec<&'static str> {
    let mut packages = Vec::new();
    if !qemu_ready {
        packages.extend_from_slice(QEMU_PACKAGES);
    }
    if !secret_service_available && !keyring_installed {
        packages.extend_from_slice(SECRET_SERVICE_PACKAGES);
    }
    packages
}

fn dependency_packages() -> Vec<&'static str> {
    QEMU_PACKAGES
        .iter()
        .chain(SECRET_SERVICE_PACKAGES)
        .copied()
        .collect()
}

fn install_command(packages: &[&str]) -> String {
    if packages.is_empty() {
        String::new()
    } else {
        format!(
            "apt-get {} {}",
            APT_INSTALL_FLAGS.join(" "),
            packages.join(" ")
        )
    }
}

fn empty_setup() -> LinuxSetup {
    LinuxSetup {
        linux: false,
        distribution: String::new(),
        can_install: false,
        qemu_ready: false,
        keyring_installed: false,
        secret_service_available: false,
        kvm_present: false,
        kvm_accessible: false,
        active_kvm_member: false,
        kvm_pending_relogin: false,
        can_enable_kvm: false,
        install_command: install_command(&dependency_packages()),
        enable_kvm_command: "usermod --append --groups kvm -- <current user>".into(),
    }
}

pub fn inspect() -> LinuxSetup {
    if !cfg!(target_os = "linux") {
        return empty_setup();
    }
    let release = fs::read_to_string("/etc/os-release").unwrap_or_default();
    let supported = ubuntu_24(&release);
    let distribution = release
        .lines()
        .find_map(|line| line.strip_prefix("PRETTY_NAME="))
        .unwrap_or("Linux")
        .trim_matches('"')
        .to_string();
    let username = current_username();
    let groups = fs::read_to_string("/etc/group").unwrap_or_default();
    let kvm_group_exists = groups.lines().any(|line| line.starts_with("kvm:"));
    let kvm_member = username
        .as_deref()
        .is_some_and(|username| group_contains_user(&groups, "kvm", username));
    let kvm_present = Path::new("/dev/kvm").exists();
    let kvm_accessible = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/kvm")
        .is_ok();
    let active_kvm_member = current_groups()
        .as_deref()
        .is_some_and(|groups| group_list_contains(groups, "kvm"));
    let qemu_ready = Path::new("/usr/bin/qemu-img").is_file()
        && Path::new("/usr/bin/qemu-system-x86_64").is_file();
    let keyring_installed = Path::new("/usr/bin/gnome-keyring-daemon").is_file();
    let secret_service_available = secret_service_available();
    let packages = required_packages(qemu_ready, secret_service_available, keyring_installed);
    LinuxSetup {
        linux: true,
        distribution,
        can_install: supported
            && Path::new("/usr/bin/pkexec").is_file()
            && Path::new("/usr/bin/apt-get").is_file(),
        qemu_ready,
        keyring_installed,
        secret_service_available,
        kvm_present,
        kvm_accessible,
        active_kvm_member,
        kvm_pending_relogin: kvm_pending_relogin(KvmState {
            present: kvm_present,
            accessible: kvm_accessible,
            configured_member: kvm_member,
            active_member: active_kvm_member,
        }),
        can_enable_kvm: supported
            && kvm_present
            && !kvm_member
            && !active_kvm_member
            && Path::new("/usr/bin/pkexec").is_file()
            && kvm_group_exists,
        install_command: install_command(&packages),
        enable_kvm_command: username
            .map(|username| format!("usermod --append --groups kvm -- {username}"))
            .unwrap_or_else(|| "usermod --append --groups kvm -- <current user>".into()),
    }
}

fn repair_arguments(
    repair: Repair,
    status: &LinuxSetup,
    username: Option<&str>,
) -> Result<Vec<OsString>, String> {
    match repair {
        Repair::InstallDependencies if status.can_install => {
            let packages = required_packages(
                status.qemu_ready,
                status.secret_service_available,
                status.keyring_installed,
            );
            if packages.is_empty() {
                return Err("System requirements are already installed".into());
            }
            Ok(std::iter::once(OsString::from("/usr/bin/apt-get"))
                .chain(APT_INSTALL_FLAGS.iter().copied().map(OsString::from))
                .chain(packages.into_iter().map(OsString::from))
                .collect())
        }
        Repair::EnableKvm if status.can_enable_kvm => {
            let username = username.ok_or("Could not identify the current local user")?;
            if username.is_empty() {
                return Err("Local username is empty".into());
            }
            Ok([
                "/usr/sbin/usermod",
                "--append",
                "--groups",
                "kvm",
                "--",
                username,
            ]
            .into_iter()
            .map(OsString::from)
            .collect())
        }
        _ => Err("This repair is unavailable on this system. Ubuntu 24.04 is supported for automatic setup.".into()),
    }
}

fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let reversed = text.chars().rev().take(2048).collect::<String>();
    reversed
        .chars()
        .rev()
        .collect::<String>()
        .trim()
        .replace(['\n', '\r'], " ")
}

#[derive(Clone, Copy)]
enum RecoveryHint {
    Apt,
    System,
}

fn privileged_failure(
    code: Option<i32>,
    stderr: &[u8],
    action: &str,
    recovery: RecoveryHint,
) -> String {
    match code {
        Some(PKEXEC_CANCELLED) => return "Authorization was cancelled. No system changes were requested.".into(),
        Some(PKEXEC_DENIED) => return "System authorization was denied or is unavailable. Check that an Ubuntu polkit agent is running.".into(),
        _ => {}
    }
    let output = stderr_tail(stderr);
    let lowercase = output.to_ascii_lowercase();
    let detail = if output.is_empty() {
        String::new()
    } else {
        format!(" Last output: {output}")
    };
    let recovery = match recovery {
        RecoveryHint::Apt if lowercase.contains("could not get lock") => {
            " Another package update is running; wait for it to finish, then retry."
        }
        RecoveryHint::Apt
            if lowercase.contains("failed to fetch")
                || lowercase.contains("temporary failure resolving") =>
        {
            " Connect this machine to the package repository, then retry."
        }
        RecoveryHint::Apt => {
            " Retry later. If packages were left incomplete, run sudo apt-get --fix-broken install."
        }
        RecoveryHint::System => {
            " Review the local group configuration and system logs, then retry."
        }
    };
    format!(
        "{action} failed (exit code {}).{detail}{recovery}",
        code.map_or_else(|| "unknown".into(), |code| code.to_string())
    )
}

fn run_privileged(
    arguments: &[OsString],
    action: &str,
    recovery: RecoveryHint,
) -> Result<(), String> {
    let output = host_command(Path::new("/usr/bin/pkexec"))
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not open system authorization: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(privileged_failure(
            output.status.code(),
            &output.stderr,
            action,
            recovery,
        ))
    }
}

fn repair_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    match REPAIR.try_lock() {
        Ok(guard) => Ok(guard),
        Err(TryLockError::WouldBlock) => Err("System setup is already running".into()),
        Err(TryLockError::Poisoned(_)) => {
            Err("System setup state is unavailable; restart MoltNet Agent".into())
        }
    }
}

/// No program, package, group, username, or shell text comes from the renderer.
pub fn repair(repair: Repair) -> Result<LinuxSetup, String> {
    let _guard = repair_guard()?;
    let status = inspect();
    let username = (repair == Repair::EnableKvm)
        .then(current_username)
        .flatten();
    let arguments = repair_arguments(repair, &status, username.as_deref())?;
    let (action, recovery) = match repair {
        Repair::InstallDependencies => ("Package installation", RecoveryHint::Apt),
        Repair::EnableKvm => ("KVM access setup", RecoveryHint::System),
    };
    run_privileged(&arguments, action, recovery)?;
    Ok(inspect())
}

#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn deb_install_arguments(package: &Path) -> Result<Vec<OsString>, String> {
    if !package.is_absolute() {
        return Err("Desktop update package path must be absolute".into());
    }
    Ok([OsString::from("/usr/bin/apt-get")]
        .into_iter()
        .chain(APT_INSTALL_FLAGS.iter().copied().map(OsString::from))
        .chain(std::iter::once(package.as_os_str().to_owned()))
        .collect())
}

/// The caller supplies bytes verified by the Tauri updater, never a renderer path.
#[cfg(target_os = "linux")]
pub fn install_deb(bytes: &[u8]) -> Result<(), String> {
    let _guard = repair_guard()?;
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let package = directory.path().join("update.deb");
    fs::write(&package, bytes).map_err(|error| error.to_string())?;
    let package = fs::canonicalize(package).map_err(|error| error.to_string())?;
    run_privileged(
        &deb_install_arguments(&package)?,
        "Package installation",
        RecoveryHint::Apt,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installable() -> LinuxSetup {
        LinuxSetup {
            can_install: true,
            can_enable_kvm: true,
            ..empty_setup()
        }
    }

    #[test]
    fn automatic_setup_is_limited_to_the_supported_ubuntu_release() {
        assert!(ubuntu_24("ID=ubuntu\nVERSION_ID=\"24.04\"\n"));
        assert!(!ubuntu_24(
            "ID=debian\nID_LIKE=ubuntu\nVERSION_ID=\"24.04\"\n"
        ));
        assert!(!ubuntu_24("ID=ubuntu\nVERSION_ID=\"22.04\"\n"));
        assert!(!ubuntu_24(""));
    }
    #[test]
    fn renderer_cannot_select_arbitrary_repairs() {
        assert!(serde_json::from_str::<Repair>("\"shell\"").is_err());
        assert!(serde_json::from_str::<Repair>("\"install_dependencies\"").is_ok());
    }

    #[test]
    fn privileged_arguments_are_fixed_and_package_updates_use_apt() {
        let status = installable();
        assert_eq!(
            repair_arguments(Repair::InstallDependencies, &status, None).unwrap(),
            [
                "/usr/bin/apt-get",
                "install",
                "--yes",
                "--no-remove",
                "--no-install-recommends",
                "qemu-utils",
                "qemu-system-x86",
                "gnome-keyring",
                "libsecret-1-0",
                "dbus-bin",
            ]
            .map(OsString::from)
        );
        assert_eq!(
            repair_arguments(Repair::EnableKvm, &status, Some("alice")).unwrap(),
            [
                "/usr/sbin/usermod",
                "--append",
                "--groups",
                "kvm",
                "--",
                "alice",
            ]
            .map(OsString::from)
        );
        assert_eq!(
            deb_install_arguments(Path::new("/tmp/update.deb")).unwrap(),
            [
                "/usr/bin/apt-get",
                "install",
                "--yes",
                "--no-remove",
                "--no-install-recommends",
                "/tmp/update.deb",
            ]
            .map(OsString::from)
        );
    }

    #[test]
    fn unavailable_repairs_and_privileged_failures_are_distinct() {
        assert!(
            repair_arguments(Repair::InstallDependencies, &empty_setup(), None)
                .unwrap_err()
                .contains("unavailable")
        );
        assert!(
            privileged_failure(Some(PKEXEC_CANCELLED), b"", "Setup", RecoveryHint::Apt)
                .contains("cancelled")
        );
        assert!(
            privileged_failure(Some(PKEXEC_DENIED), b"", "Setup", RecoveryHint::Apt)
                .contains("denied")
        );
        let failed = privileged_failure(
            Some(100),
            b"Could not get lock\n",
            "Setup",
            RecoveryHint::Apt,
        );
        assert!(failed.contains("package update is running"));
        let offline = privileged_failure(
            Some(100),
            b"Temporary failure resolving archive.ubuntu.com\n",
            "Setup",
            RecoveryHint::Apt,
        );
        assert!(offline.contains("Connect this machine"));
        let group = privileged_failure(Some(1), b"usermod failed", "KVM", RecoveryHint::System);
        assert!(group.contains("group configuration"));
        let generic = privileged_failure(Some(100), b"broken", "Setup", RecoveryHint::Apt);
        assert!(generic.contains("--fix-broken"));
    }

    #[test]
    fn kvm_group_membership_requires_an_exact_member() {
        let groups = "kvm:x:108:alice,bob\nother:x:109:mallory\n";
        assert!(group_contains_user(groups, "kvm", "alice"));
        assert!(group_contains_user(groups, "kvm", "bob"));
        assert!(!group_contains_user(groups, "kvm", "ali"));
        assert!(!group_contains_user(groups, "other", "alice"));
        assert!(group_list_contains("alice adm kvm sudo", "kvm"));
        assert!(!group_list_contains("alice adm kvm-user sudo", "kvm"));
    }

    #[test]
    fn pending_kvm_relogin_requires_membership_missing_from_the_active_session() {
        let pending = KvmState {
            present: true,
            accessible: false,
            configured_member: true,
            active_member: false,
        };
        assert!(kvm_pending_relogin(pending));
        assert!(!kvm_pending_relogin(KvmState {
            active_member: true,
            ..pending
        }));
        assert!(!kvm_pending_relogin(KvmState {
            accessible: true,
            ..pending
        }));
        assert!(!kvm_pending_relogin(KvmState {
            present: false,
            ..pending
        }));
    }

    #[test]
    fn dependency_repairs_install_only_missing_capabilities() {
        assert_eq!(
            required_packages(false, true, false),
            ["qemu-utils", "qemu-system-x86"]
        );
        assert_eq!(
            required_packages(true, false, false),
            ["gnome-keyring", "libsecret-1-0", "dbus-bin"]
        );
        assert!(required_packages(true, true, false).is_empty());

        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.linux.conf.json")).unwrap();
        let depends = config["bundle"]["linux"]["deb"]["depends"]
            .as_array()
            .unwrap();
        let recommends = config["bundle"]["linux"]["deb"]["recommends"]
            .as_array()
            .unwrap();
        for package in dependency_packages() {
            assert!(
                depends
                    .iter()
                    .chain(recommends)
                    .any(|value| value.as_str() == Some(package)),
                "{package} is absent from the deb package metadata"
            );
        }
    }

    #[test]
    fn completed_dependency_setup_has_no_command_or_privileged_action() {
        let mut status = installable();
        status.qemu_ready = true;
        status.secret_service_available = true;
        assert!(install_command(&[]).is_empty());
        assert_eq!(
            repair_arguments(Repair::InstallDependencies, &status, None).unwrap_err(),
            "System requirements are already installed"
        );
    }

    #[test]
    fn deb_install_rejects_relative_paths() {
        assert!(deb_install_arguments(Path::new("update.deb")).is_err());
        assert!(deb_install_arguments(Path::new("/tmp/update.deb")).is_ok());
    }
}
