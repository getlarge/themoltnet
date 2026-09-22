use std::{env, fs, path::PathBuf};

mod build_support;

use build_support::{render_installer, resolve_agent_cli_version, version_at_least};

const RELEASE_SIGNER_PUBKEY: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIsffodWdp+Y0UUFJq8yaFcI08nhSfxkVe4hZKhGGv5Y";
fn main() {
    let template_path = PathBuf::from("../../../tools/release/agent-bundle/install.sh");
    let minimum_path = PathBuf::from("../agent-cli.minimum-version");
    println!("cargo:rerun-if-changed={}", template_path.display());
    println!("cargo:rerun-if-changed={}", minimum_path.display());
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=MOLTNET_AGENT_CLI_VERSION");

    let minimum_version =
        fs::read_to_string(&minimum_path).expect("read minimum Agent CLI version");
    let override_version = env::var("MOLTNET_AGENT_CLI_VERSION").ok();
    let agent_cli_version =
        resolve_agent_cli_version(minimum_version.trim(), override_version.as_deref())
            .expect("resolve embedded Agent CLI version");
    assert!(
        version_at_least(agent_cli_version, minimum_version.trim()),
        "embedded Agent CLI version {agent_cli_version} is below the Desktop minimum {}; update MOLTNET_AGENT_CLI_VERSION or apps/agent-desktop/agent-cli.minimum-version",
        minimum_version.trim()
    );
    println!("cargo:rustc-env=MOLTNET_EMBEDDED_AGENT_CLI_VERSION={agent_cli_version}");

    let template = fs::read_to_string(&template_path).expect("read canonical agent installer");
    let installer = render_installer(&template, RELEASE_SIGNER_PUBKEY, agent_cli_version)
        .expect("render canonical agent installer");

    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    fs::write(out.join("install-agent.sh"), installer).expect("write embedded installer");
    let protocol_path = PathBuf::from("../../../libs/models/src/operator-oauth-parameters.json");
    println!("cargo:rerun-if-changed={}", protocol_path.display());
    let protocol: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(protocol_path).expect("read shared operator OAuth parameters"),
    )
    .expect("parse shared operator OAuth parameters");
    let number = |key: &str| {
        protocol[key]
            .as_u64()
            .filter(|value| *value > 0)
            .expect("operator OAuth parameters must be positive integers")
    };
    let timeout = number("nativeLifetimeSeconds")
        .checked_add(number("approvalTransportGraceSeconds"))
        .expect("operator approval timeout overflow");
    fs::write(
        out.join("operator-oauth.rs"),
        format!("pub const APPROVAL_TIMEOUT_SECONDS: u64 = {timeout};\n"),
    )
    .expect("write shared native operator OAuth parameters");
    tauri_build::build();
}
