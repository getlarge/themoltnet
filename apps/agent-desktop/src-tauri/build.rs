use std::{env, fs, path::PathBuf};

const AGENT_CLI_VERSION: &str = "0.56.2";
const RELEASE_SIGNER_PUBKEY: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIsffodWdp+Y0UUFJq8yaFcI08nhSfxkVe4hZKhGGv5Y";

fn main() {
    let template_path = PathBuf::from("../../../tools/release/agent-bundle/install.sh");
    println!("cargo:rerun-if-changed={}", template_path.display());
    println!("cargo:rerun-if-changed=build.rs");

    let template = fs::read_to_string(&template_path).expect("read canonical agent installer");
    assert!(
        RELEASE_SIGNER_PUBKEY.starts_with("ssh-ed25519 "),
        "release trust anchor must be an OpenSSH Ed25519 public key"
    );
    let installer = template
        .replacen(
            "RELEASE_SIGNER_PUBKEY=\"\"",
            &format!("RELEASE_SIGNER_PUBKEY=\"{RELEASE_SIGNER_PUBKEY}\""),
            1,
        )
        .replacen(
            "RELEASE_PINNED_VERSION=\"\"",
            &format!("RELEASE_PINNED_VERSION=\"{AGENT_CLI_VERSION}\""),
            1,
        );
    assert!(!installer.contains("RELEASE_SIGNER_PUBKEY=\"\""));
    assert!(!installer.contains("RELEASE_PINNED_VERSION=\"\""));

    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    fs::write(out.join("install-agent.sh"), installer).expect("write embedded installer");
    tauri_build::build();
}
