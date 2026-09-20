//! Read-only Linux readiness and narrowly defined, explicitly requested repairs.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

static REPAIR: Mutex<()> = Mutex::new(());

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
    pub can_enable_kvm: bool,
}

#[derive(Clone, Copy, Debug, Deserialize)]
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

// Ask only whether a Secret Service owns its session-bus name. Do not unlock,
// activate a service, read a secret, or prompt during a readiness check.
fn secret_service_available() -> bool {
    Command::new("/usr/bin/dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--reply-timeout=1000",
            "--dest=org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus.GetNameOwner",
            "string:org.freedesktop.secrets",
        ])
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD")
        .output()
        .is_ok_and(|output| output.status.success())
}

pub fn inspect() -> LinuxSetup {
    if !cfg!(target_os = "linux") {
        return LinuxSetup {
            linux: false,
            distribution: String::new(),
            can_install: false,
            qemu_ready: false,
            keyring_installed: false,
            secret_service_available: false,
            kvm_present: false,
            kvm_accessible: false,
            can_enable_kvm: false,
        };
    }
    let release = fs::read_to_string("/etc/os-release").unwrap_or_default();
    let supported = ubuntu_24(&release);
    let distribution = release
        .lines()
        .find_map(|line| line.strip_prefix("PRETTY_NAME="))
        .unwrap_or("Linux")
        .trim_matches('"')
        .to_string();
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
        can_enable_kvm: supported
            && kvm_present
            && Path::new("/usr/bin/pkexec").is_file()
            && fs::read_to_string("/etc/group")
                .is_ok_and(|groups| groups.lines().any(|line| line.starts_with("kvm:"))),
    }
}

/// No program, package, group, username, or shell text comes from the renderer.
pub fn repair(repair: Repair) -> Result<LinuxSetup, String> {
    let _guard = REPAIR
        .try_lock()
        .map_err(|_| "System setup is already running")?;
    let status = inspect();
    let mut command = Command::new("/usr/bin/pkexec");
    command
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD");
    match repair {
        Repair::InstallDependencies if status.can_install => {
            command.args(["/usr/bin/apt-get", "install", "--yes", "qemu-utils", "qemu-system-x86", "gnome-keyring", "libsecret-1-0"]);
        }
        Repair::EnableKvm if status.can_enable_kvm => {
            let user = Command::new("/usr/bin/id").arg("-un")
                .env_remove("LD_LIBRARY_PATH").env_remove("LD_PRELOAD")
                .output().map_err(|_| "Could not identify the current local user")?;
            if !user.status.success() { return Err("Could not identify the current local user".into()); }
            let username = std::str::from_utf8(&user.stdout).map_err(|_| "Invalid local username")?.trim();
            if username.is_empty() { return Err("Local username is empty".into()); }
            command.args(["/usr/sbin/usermod", "--append", "--groups", "kvm", "--", username]);
        }
        _ => return Err("This repair is unavailable on this system. Ubuntu 24.04 is supported for automatic setup.".into()),
    }
    let result = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| {
            "Could not open system authorization. Check that a polkit agent is running."
        })?;
    if result.success() {
        Ok(inspect())
    } else {
        Err("System setup was cancelled or could not finish. Check your system package manager before retrying.".into())
    }
}

/// The caller supplies bytes verified by the Tauri updater, never a renderer path.
#[cfg(target_os = "linux")]
pub fn install_deb(bytes: &[u8]) -> Result<(), String> {
    let _guard = REPAIR
        .try_lock()
        .map_err(|_| "System setup is already running")?;
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let package = directory.path().join("update.deb");
    fs::write(&package, bytes).map_err(|error| error.to_string())?;
    let status = Command::new("/usr/bin/pkexec")
        .args(["/usr/bin/dpkg", "--install"])
        .arg(package)
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Could not open system authorization")?;
    if status.success() {
        Ok(())
    } else {
        Err("Update cancelled or installation failed. Desktop has not restarted.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
