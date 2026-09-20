//! Authenticated client for the local Agent Server's desktop-control API.
//!
//! The point of this module is where the token *is not*: it lives in native
//! memory for the lifetime of one server process and never reaches the
//! WebView. The renderer asks for data through Tauri commands and receives
//! results; it never holds a credential it could leak through a bug, an
//! extension, or a devtools session.
//!
use crate::native_socket::SocketConnector;
use std::fs::File;
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

/// Environment variable the Agent Server reads its native grant from.
/// Must match `NATIVE_TOKEN_ENV` in the daemon's `native-grant.ts`.
pub const NATIVE_TOKEN_ENV: &str = "MOLTNET_AGENT_SERVER_NATIVE_TOKEN";

const TOKEN_HEADER: &str = "x-moltnet-agent-server-token";
/// Must match `NATIVE_CLIENT_ORIGIN` in the daemon's `native-grant-service.ts`.
const NATIVE_ORIGIN: &str = "moltnet-agent-desktop://native";
use crate::operator_oauth::APPROVAL_TIMEOUT_SECONDS;
const BASE_URL: &str = "http://127.0.0.1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// 32 bytes of entropy, base64url-encoded without padding.
const TOKEN_BYTES: usize = 32;

/// A process-scoped grant for one Agent Server child.
///
/// Generated fresh per spawn, so a token disclosed from an earlier supervisor
/// cannot authenticate to a later one.
#[derive(Clone)]
pub struct NativeToken(String);

impl NativeToken {
    pub fn generate() -> Result<Self, String> {
        // The kernel CSPRNG, read directly: no userspace PRNG to seed or
        // misuse, and no unsafe block.
        let mut bytes = [0u8; TOKEN_BYTES];
        let mut source = File::open("/dev/urandom")
            .map_err(|error| format!("could not open the system entropy source: {error}"))?;
        source
            .read_exact(&mut bytes)
            .map_err(|error| format!("could not read secure randomness: {error}"))?;
        Ok(Self(base64_url_nopad(&bytes)))
    }

    /// Only for handing to the child process environment and the auth header.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

/// Deliberately opaque: a stray `{:?}` must not print the grant.
impl std::fmt::Debug for NativeToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeToken(redacted)")
    }
}

/// One managed server's endpoint, authenticated peer and in-memory grant.
#[derive(Clone, Debug)]
pub struct NativeConnection {
    token: NativeToken,
    client: ureq::Agent,
    approval_client: ureq::Agent,
    health_client: ureq::Agent,
    // Keep the private directory alive until every in-flight request finishes.
    _directory: Arc<tempfile::TempDir>,
}

impl NativeConnection {
    pub fn new(token: NativeToken, directory: Arc<tempfile::TempDir>, pid: u32) -> Self {
        let connector = SocketConnector {
            directory: directory.clone(),
            pid,
        };
        let client = |timeout| {
            ureq::Agent::with_parts(
                ureq::Agent::config_builder()
                    .timeout_global(Some(timeout))
                    .proxy(None)
                    .max_redirects(0)
                    .http_status_as_error(false)
                    .build(),
                connector.clone(),
                ureq::unversioned::resolver::DefaultResolver::default(),
            )
        };
        Self {
            token,
            client: client(REQUEST_TIMEOUT),
            approval_client: client(Duration::from_secs(APPROVAL_TIMEOUT_SECONDS)),
            health_client: client(Duration::from_secs(1)),
            _directory: directory,
        }
    }

    pub fn health(&self) -> Result<(), String> {
        finish(
            self.health_client
                .get(format!("{BASE_URL}/health"))
                .header(TOKEN_HEADER, self.token.expose())
                .header("origin", NATIVE_ORIGIN)
                .call(),
        )
        .map(|_| ())
    }
}

/// Read from the control API.
pub fn get(connection: &NativeConnection, path: &str) -> Result<String, String> {
    let response = connection
        .client
        .clone()
        .get(format!("{BASE_URL}{path}"))
        .header(TOKEN_HEADER, connection.token.expose())
        .header("origin", NATIVE_ORIGIN)
        .call();
    finish(response)
}

/// Write to the control API with a JSON payload.
pub fn post(connection: &NativeConnection, path: &str, body: &str) -> Result<String, String> {
    let client = if path == "/v1/operator/sign-in"
        || (path.starts_with("/v1/agents/") && path.ends_with("/teams"))
    {
        connection.approval_client.clone()
    } else {
        connection.client.clone()
    };
    let response = client
        .post(format!("{BASE_URL}{path}"))
        .header(TOKEN_HEADER, connection.token.expose())
        .header("origin", NATIVE_ORIGIN)
        .header("content-type", "application/json")
        .send(body);
    finish(response)
}

/// Replace a resource through the control API.
pub fn put(connection: &NativeConnection, path: &str, body: &str) -> Result<String, String> {
    let response = connection
        .client
        .clone()
        .put(format!("{BASE_URL}{path}"))
        .header(TOKEN_HEADER, connection.token.expose())
        .header("origin", NATIVE_ORIGIN)
        .header("content-type", "application/json")
        .send(body);
    finish(response)
}

/// Delete through the control API.
pub fn delete(connection: &NativeConnection, path: &str) -> Result<String, String> {
    let response = connection
        .client
        .clone()
        .delete(format!("{BASE_URL}{path}"))
        .header(TOKEN_HEADER, connection.token.expose())
        .header("origin", NATIVE_ORIGIN)
        .call();
    finish(response)
}

/// Read the body, preferring the server's own problem message on failure.
fn finish(result: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Result<String, String> {
    match result {
        Ok(mut response) => {
            let status = response.status();
            let body = response
                .body_mut()
                .read_to_string()
                .map_err(|error| format!("could not read the Agent Server response: {error}"))?;
            if status.is_success() {
                return Ok(body);
            }
            // The server's own message names the cause and the remedy; a bare
            // status code names neither.
            Err(problem_message(&body)
                .unwrap_or_else(|| format!("the Agent Server rejected the request ({status})")))
        }
        Err(error) => Err(format!("could not reach the Agent Server: {error}")),
    }
}

/// Extract the server's own problem message, which is friendlier than a code.
fn problem_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value.get("message")?.as_str().map(str::to_string)
}

/// Explicit allowlist prevents an upstream response extension exposing a secret.
pub fn enrollment_metadata(body: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "Unreadable enrollment response".to_string())?;
    let fields: &[&str] = match value.get("state").and_then(|v| v.as_str()) {
        Some("persisted") => &["state", "teamId", "keyId"],
        Some("recovery_required") => &[
            "state",
            "secretCaptured",
            "issuedKeyId",
            "recoveryId",
            "message",
        ],
        _ => return Err("Unknown enrollment response".to_string()),
    };
    let mut output = serde_json::Map::new();
    for field in fields {
        if let Some(item) = value.get(*field) {
            output.insert((*field).to_string(), item.clone());
        }
    }
    Ok(serde_json::Value::Object(output))
}

fn base64_url_nopad(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrollment_response_never_forwards_credential_material() {
        let result = enrollment_metadata(r#"{"state":"persisted","teamId":"team","keyId":"key","secret":"sentinel","agentKey":{"secret":"sentinel"}}"#).unwrap();
        assert_eq!(
            result,
            serde_json::json!({"state":"persisted","teamId":"team","keyId":"key"})
        );
    }

    #[test]
    fn generates_a_token_with_enough_entropy_to_resist_guessing() {
        let token = NativeToken::generate().expect("token");
        // 32 bytes base64url without padding is 43 characters.
        assert_eq!(token.expose().len(), 43);
        assert!(token
            .expose()
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn generates_a_distinct_token_per_server_process() {
        let first = NativeToken::generate().expect("token");
        let second = NativeToken::generate().expect("token");
        assert_ne!(first.expose(), second.expose());
    }

    #[test]
    fn redacts_the_token_from_debug_output() {
        // A stray log line must not disclose the grant.
        let token = NativeToken::generate().expect("token");
        let rendered = format!("{token:?}");
        assert_eq!(rendered, "NativeToken(redacted)");
        assert!(!rendered.contains(token.expose()));
    }

    #[test]
    fn prefers_the_servers_own_problem_message() {
        let body = r#"{"code":"native_token_invalid","message":"Native token is not valid"}"#;
        assert_eq!(
            problem_message(body).as_deref(),
            Some("Native token is not valid")
        );
    }

    #[test]
    fn falls_back_when_the_body_is_not_a_problem_document() {
        assert_eq!(problem_message("not json"), None);
        assert_eq!(problem_message(r#"{"code":"x"}"#), None);
    }
}
