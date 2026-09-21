// This file is compiled by both build.rs and the Desktop library so the two
// consumers share one strict version parser.
#[allow(dead_code)]
pub fn resolve_agent_cli_version<'a>(
    default_version: &'a str,
    override_version: Option<&'a str>,
) -> Result<&'a str, &'static str> {
    let version = override_version.unwrap_or(default_version);
    valid_version(version)
        .then_some(version)
        .ok_or("embedded Agent CLI version must be a stable semantic version")
}

pub fn version_at_least(version: &str, minimum: &str) -> bool {
    matches!((parse_version(version), parse_version(minimum)), (Some(version), Some(minimum)) if version >= minimum)
}

#[allow(dead_code)]
pub fn render_installer(
    template: &str,
    release_signer_pubkey: &str,
    agent_cli_version: &str,
) -> Result<String, &'static str> {
    if !release_signer_pubkey.starts_with("ssh-ed25519 ") {
        return Err("release trust anchor must be an OpenSSH Ed25519 public key");
    }
    if !valid_version(agent_cli_version) {
        return Err("embedded Agent CLI version must be a stable semantic version");
    }
    if template.matches("RELEASE_SIGNER_PUBKEY=\"\"").count() != 1
        || template.matches("RELEASE_PINNED_VERSION=\"\"").count() != 1
    {
        return Err("canonical installer must contain exactly one empty key and version pin");
    }

    Ok(template
        .replacen(
            "RELEASE_SIGNER_PUBKEY=\"\"",
            &format!("RELEASE_SIGNER_PUBKEY=\"{release_signer_pubkey}\""),
            1,
        )
        .replacen(
            "RELEASE_PINNED_VERSION=\"\"",
            &format!("RELEASE_PINNED_VERSION=\"{agent_cli_version}\""),
            1,
        ))
}

pub fn valid_version(value: &str) -> bool {
    parse_version(value).is_some()
}

pub fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let pieces = value.split('.').collect::<Vec<_>>();
    if pieces.len() != 3
        || pieces.iter().any(|piece| {
            piece.is_empty()
                || (piece.len() > 1 && piece.starts_with('0'))
                || !piece.chars().all(|character| character.is_ascii_digit())
        })
    {
        return None;
    }
    Some((
        pieces[0].parse().ok()?,
        pieces[1].parse().ok()?,
        pieces[2].parse().ok()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest";
    const TEMPLATE: &str = r#"RELEASE_SIGNER_PUBKEY=""
RELEASE_PINNED_VERSION=""
"#;

    #[test]
    fn version_resolution_covers_fallback_override_and_invalid_values() {
        assert_eq!(resolve_agent_cli_version("0.57.0", None), Ok("0.57.0"));
        assert_eq!(
            resolve_agent_cli_version("0.57.0", Some("1.2.3")),
            Ok("1.2.3")
        );
        for invalid in ["", "01.2.3", "1.2", "1.2.3-beta", "../1.2.3"] {
            assert!(resolve_agent_cli_version("0.57.0", Some(invalid)).is_err());
        }
        assert!(resolve_agent_cli_version("01.2.3", None).is_err());
    }

    #[test]
    fn version_floor_uses_semantic_components() {
        assert!(version_at_least("0.62.0", "0.62.0"));
        assert!(version_at_least("1.0.0", "0.62.0"));
        assert!(!version_at_least("0.61.9", "0.62.0"));
        assert!(!version_at_least("invalid", "0.62.0"));
        assert!(!version_at_least("01.62.0", "0.62.0"));
        assert!(!version_at_least("+1.0.0", "0.62.0"));
    }

    #[test]
    fn generated_installer_contains_only_the_requested_release_material() {
        let installer = render_installer(TEMPLATE, KEY, "1.2.3").unwrap();

        assert!(installer.contains(&format!("RELEASE_SIGNER_PUBKEY=\"{KEY}\"")));
        assert!(installer.contains("RELEASE_PINNED_VERSION=\"1.2.3\""));
        assert!(!installer.contains("RELEASE_SIGNER_PUBKEY=\"\""));
        assert!(!installer.contains("RELEASE_PINNED_VERSION=\"\""));
    }

    #[test]
    fn generated_installer_rejects_incomplete_or_ambiguous_templates() {
        assert!(render_installer("RELEASE_PINNED_VERSION=\"\"", KEY, "1.2.3").is_err());
        assert!(render_installer(TEMPLATE, "not-an-ssh-key", "1.2.3").is_err());
        assert!(render_installer(TEMPLATE, KEY, "01.2.3").is_err());
    }
}
