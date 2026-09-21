//! Read-only Linux readiness and narrowly defined, explicitly requested repairs.
use crate::lifecycle::host_command;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Mutex, TryLockError};

static REPAIR: Mutex<()> = Mutex::new(());
const DEPENDENCY_PACKAGES: &[&str] = &[
    "qemu-utils",
    "qemu-system-x86",
    "gnome-keyring",
    "libsecret-1-0",
    "dbus-bin",
];

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

fn group_contains_user(groups: &str, group: &str, username: &str) -> bool {
    groups.lines().any(|line| {
        let mut fields = line.splitn(4, ':');
        fields.next() == Some(group)
            && fields
                .nth(2)
                .is_some_and(|members| members.split(',').any(|member| member == username))
    })
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

fn install_command() -> String {
    format!("apt-get install --yes {}", DEPENDENCY_PACKAGES.join(" "))
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
        kvm_pending_relogin: false,
        can_enable_kvm: false,
        install_command: install_command(),
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
    LinuxSetup {
        linux: true,
        distribution,
        can_install: supported
            && Path::new("/usr/bin/pkexec").is_file()
            && Path::new("/usr/bin/apt-get").is_file(),
        qemu_ready: Path::new("/usr/bin/qemu-img").is_file()
            && Path::new("/usr/bin/qemu-system-x86_64").is_file(),
        keyring_installed: Path::new("/usr/bin/gnome-keyring-daemon").is_file(),
        secret_service_available: secret_service_available(),
        kvm_present,
        kvm_accessible,
        kvm_pending_relogin: kvm_present && kvm_member && !kvm_accessible,
        can_enable_kvm: supported
            && kvm_present
            && !kvm_member
            && Path::new("/usr/bin/pkexec").is_file()
            && kvm_group_exists,
        install_command: install_command(),
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
        Repair::InstallDependencies if status.can_install => Ok(std::iter::once(OsString::from(
            "/usr/bin/apt-get",
        ))
        .chain(["install", "--yes"].into_iter().map(OsString::from))
        .chain(
            DEPENDENCY_PACKAGES
                .iter()
                .map(|package| OsString::from(*package)),
        )
        .collect()),
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

fn privileged_failure(code: Option<i32>, stderr: &[u8], action: &str) -> String {
    match code {
        Some(126) => return "Authorization was cancelled. No system changes were requested.".into(),
        Some(127) => return "System authorization was denied or is unavailable. Check that an Ubuntu polkit agent is running.".into(),
        _ => {}
    }
    let output = stderr_tail(stderr);
    let detail = if output.is_empty() {
        String::new()
    } else {
        format!(" Last output: {output}")
    };
    format!(
        "{action} failed (exit code {}).{detail} Retry after other package updates finish. If packages were left incomplete, run sudo apt-get --fix-broken install.",
        code.map_or_else(|| "unknown".into(), |code| code.to_string())
    )
}

fn run_privileged(arguments: &[OsString], action: &str) -> Result<(), String> {
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
    run_privileged(&arguments, "System setup")?;
    Ok(inspect())
}

#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn deb_install_arguments(package: &Path) -> Result<Vec<OsString>, String> {
    if !package.is_absolute() {
        return Err("Desktop update package path must be absolute".into());
    }
    Ok([
        OsString::from("/usr/bin/apt-get"),
        OsString::from("install"),
        OsString::from("--yes"),
        package.as_os_str().to_owned(),
    ]
    .into())
}

/// The caller supplies bytes verified by the Tauri updater, never a renderer path.
#[cfg(target_os = "linux")]
pub fn install_deb(bytes: &[u8]) -> Result<(), String> {
    let _guard = repair_guard()?;
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let package = directory.path().join("update.deb");
    fs::write(&package, bytes).map_err(|error| error.to_string())?;
    let package = fs::canonicalize(package).map_err(|error| error.to_string())?;
    run_privileged(&deb_install_arguments(&package)?, "Desktop update")
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
            ["/usr/bin/apt-get", "install", "--yes", "/tmp/update.deb"].map(OsString::from)
        );
    }

    #[test]
    fn unavailable_repairs_and_privileged_failures_are_distinct() {
        assert!(
            repair_arguments(Repair::InstallDependencies, &empty_setup(), None)
                .unwrap_err()
                .contains("unavailable")
        );
        assert!(privileged_failure(Some(126), b"", "Setup").contains("cancelled"));
        assert!(privileged_failure(Some(127), b"", "Setup").contains("denied"));
        let failed = privileged_failure(Some(100), b"apt lock held\n", "Setup");
        assert!(failed.contains("apt lock held"));
        assert!(failed.contains("--fix-broken"));
    }

    #[test]
    fn kvm_group_membership_requires_an_exact_member() {
        let groups = "kvm:x:108:alice,bob\nother:x:109:mallory\n";
        assert!(group_contains_user(groups, "kvm", "alice"));
        assert!(group_contains_user(groups, "kvm", "bob"));
        assert!(!group_contains_user(groups, "kvm", "ali"));
        assert!(!group_contains_user(groups, "other", "alice"));
    }

    #[test]
    fn deb_install_rejects_relative_paths() {
        assert!(deb_install_arguments(Path::new("update.deb")).is_err());
        assert!(deb_install_arguments(Path::new("/tmp/update.deb")).is_ok());
    }
}
