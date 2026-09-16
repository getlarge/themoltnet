use std::{env, fs, path::PathBuf};

mod build_support;

use build_support::{render_installer, resolve_agent_cli_version};

const RELEASE_SIGNER_PUBKEY: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIsffodWdp+Y0UUFJq8yaFcI08nhSfxkVe4hZKhGGv5Y";

fn main() {
    let template_path = PathBuf::from("../../../tools/release/agent-bundle/install.sh");
    let pin_path = PathBuf::from("../agent-cli.version");
    println!("cargo:rerun-if-changed={}", template_path.display());
    println!("cargo:rerun-if-changed={}", pin_path.display());
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=MOLTNET_AGENT_CLI_VERSION");

    let default_version = fs::read_to_string(&pin_path).expect("read Agent CLI version pin");
    let override_version = env::var("MOLTNET_AGENT_CLI_VERSION").ok();
    let agent_cli_version =
        resolve_agent_cli_version(default_version.trim(), override_version.as_deref())
            .expect("resolve embedded Agent CLI version");
    println!("cargo:rustc-env=MOLTNET_EMBEDDED_AGENT_CLI_VERSION={agent_cli_version}");

    let template = fs::read_to_string(&template_path).expect("read canonical agent installer");
    let installer = render_installer(&template, RELEASE_SIGNER_PUBKEY, agent_cli_version)
        .expect("render canonical agent installer");

    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    fs::write(out.join("install-agent.sh"), installer).expect("write embedded installer");
    tauri_build::build();
}
