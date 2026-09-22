//! Resolve the public preset namespace without requiring an installed/running daemon.
//! Keep the connection identity contract aligned with ConnectionSettingsStore.
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use crate::store_root::{is_default_store, resolve_store_path};

pub const API: &str = "https://api.themolt.net";
const ISSUER: &str = "https://auth.themolt.net";

#[derive(Clone)]
pub struct PresetScope {
    pub root: PathBuf,
    pub home: PathBuf,
}

impl PresetScope {
    pub fn resolve(&self) -> Result<String, String> {
        self.resolve_with_environment(&Value::Object(launch_environment()?))
    }

    /// The API this Desktop talks to: launch environment over saved settings.
    pub fn effective_api(&self) -> Result<String, String> {
        let overrides = self.overrides()?;
        let mut settings = validate(&overrides)?;
        settings.extend(validate(&Value::Object(launch_environment()?))?);
        Ok(settings
            .get("apiUrl")
            .and_then(Value::as_str)
            .unwrap_or(API)
            .trim_end_matches('/')
            .to_owned())
    }

    fn overrides(&self) -> Result<Value, String> {
        match fs::read(self.root.join("connection-settings.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid connection settings: {e}")),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(serde_json::json!({})),
            Err(e) => Err(e.to_string()),
        }
    }

    fn resolve_with_environment(&self, environment: &Value) -> Result<String, String> {
        let overrides = self.overrides()?;
        let root = resolve_store_path(Some(&self.root), None, &self.home, &self.home)?;
        let effective = connection_root(&root, &overrides, environment)?;
        if is_default_store(&effective, &self.home) {
            return Ok(String::new());
        }
        effective
            .to_str()
            .map(str::to_owned)
            .ok_or("Invalid preset storage path".into())
    }
}

/// Connection overrides from the launch environment, as the daemon reads them.
fn launch_environment() -> Result<Map<String, Value>, String> {
    let mut environment = Map::new();
    for (key, variable) in [
        ("issuer", "MOLTNET_OPERATOR_OAUTH_ISSUER"),
        ("publicUrl", "MOLTNET_OPERATOR_OAUTH_PUBLIC_URL"),
        ("nativeClientId", "MOLTNET_NATIVE_OAUTH_CLIENT_ID"),
        ("consoleClientId", "MOLTNET_CONSOLE_OAUTH_CLIENT_ID"),
        ("apiUrl", "MOLTNET_OPERATOR_API_URL"),
        ("apiUrl", "MOLTNET_API_URL"),
    ] {
        if let Some(raw) = std::env::var_os(variable) {
            let text = raw
                .into_string()
                .map_err(|_| format!("Invalid {variable}"))?;
            if !text.is_empty() {
                environment.insert(key.into(), Value::String(text));
            }
        }
    }
    Ok(environment)
}

fn validate(value: &Value) -> Result<Map<String, Value>, String> {
    let values = value
        .as_object()
        .ok_or("Connection settings must be an object")?;
    let mut result = Map::new();
    for (key, value) in values {
        if ![
            "apiUrl",
            "issuer",
            "publicUrl",
            "nativeClientId",
            "consoleClientId",
        ]
        .contains(&key.as_str())
        {
            return Err(format!("Invalid connection setting: {key}"));
        }
        let text = value
            .as_str()
            .ok_or("Connection settings must be strings")?
            .trim();
        if text.is_empty() {
            return Err(format!("Invalid connection setting: {key}"));
        }
        if key.ends_with("ClientId") {
            if text.encode_utf16().count() > 255 || text.chars().any(char::is_whitespace) {
                return Err("Client IDs must not contain whitespace".into());
            }
        } else {
            let url = url::Url::parse(text).map_err(|e| e.to_string())?;
            let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
            if !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some_and(|value| !value.is_empty())
                || url.fragment().is_some_and(|value| !value.is_empty())
                || !(url.scheme() == "https"
                    || (url.scheme() == "http" && (key == "issuer" || loopback)))
            {
                return Err("Invalid connection URL".into());
            }
        }
        result.insert(key.clone(), Value::String(text.into()));
    }
    Ok(result)
}

fn connection_root(root: &Path, overrides: &Value, environment: &Value) -> Result<PathBuf, String> {
    let mut settings = validate(overrides)?;
    let environment = validate(environment)?;
    if environment.contains_key("apiUrl") && environment.contains_key("issuer") {
        return Ok(root.to_path_buf());
    }
    settings.extend(environment);
    let api = settings
        .get("apiUrl")
        .and_then(Value::as_str)
        .unwrap_or(API);
    let issuer = settings
        .get("issuer")
        .and_then(Value::as_str)
        .unwrap_or(ISSUER);
    let identity = [api.trim_end_matches('/'), issuer.trim_end_matches('/')];
    if identity == [API, ISSUER] {
        return Ok(root.to_path_buf());
    }
    let encoded = serde_json::to_vec(&identity).map_err(|e| e.to_string())?;
    Ok(root
        .join("environments")
        .join(format!("{:x}", Sha256::digest(encoded))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_roots_keep_default_presets_and_isolate_aliases() {
        let temporary = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(temporary.path()).unwrap();
        let default = home.join(".config/moltnet");
        fs::create_dir_all(&default).unwrap();
        let scope = PresetScope {
            root: default.clone(),
            home: home.clone(),
        };
        assert_eq!(
            scope
                .resolve_with_environment(&serde_json::json!({}))
                .unwrap(),
            ""
        );
        let separate = home.join("isolated");
        fs::create_dir(&separate).unwrap();
        #[cfg(unix)]
        {
            let alias = home.join("alias");
            std::os::unix::fs::symlink(&separate, &alias).unwrap();
            let scope = PresetScope {
                root: alias,
                home: home.clone(),
            };
            assert_eq!(
                scope
                    .resolve_with_environment(&serde_json::json!({}))
                    .unwrap(),
                separate.to_str().unwrap()
            );
            fs::write(
                separate.join("connection-settings.json"),
                r#"{"apiUrl":"https://api.example.test"}"#,
            )
            .unwrap();
            assert!(scope
                .resolve_with_environment(&serde_json::json!({}))
                .unwrap()
                .starts_with(separate.join("environments").to_str().unwrap()));
            fs::write(separate.join("connection-settings.json"), "{broken").unwrap();
            assert!(scope
                .resolve_with_environment(&serde_json::json!({}))
                .is_err());
        }
    }

    #[test]
    fn isolated_presets_do_not_depend_on_default_directory_health() {
        let temporary = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(temporary.path()).unwrap();
        fs::write(home.join(".config"), "fixture").unwrap();
        let root = home.join("isolated");
        let scope = PresetScope {
            root: root.clone(),
            home,
        };
        assert_eq!(
            scope
                .resolve_with_environment(&serde_json::json!({}))
                .unwrap(),
            root.to_str().unwrap()
        );
    }

    #[test]
    fn shares_daemon_connection_namespace_conformance() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../../../test-fixtures/connection-state-root.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let result = connection_root(
                Path::new("/store"),
                &case["overrides"],
                &case["environment"],
            );
            if case["error"] == true {
                assert!(result.is_err(), "{}", case["name"]);
            } else {
                assert_eq!(
                    result.unwrap(),
                    Path::new("/store").join(case["suffix"].as_str().unwrap()),
                    "{}",
                    case["name"]
                );
            }
        }
    }
}
