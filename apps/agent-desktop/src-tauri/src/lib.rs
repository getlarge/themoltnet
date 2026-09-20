#[path = "../build_support.rs"]
mod build_support;
mod control;
mod lifecycle;
mod linux_setup;
mod native_socket;
mod operator_oauth {
    include!(concat!(env!("OUT_DIR"), "/operator-oauth.rs"));
}
mod tray;

mod store_root;

use lifecycle::{DesktopStatus, ExitAction, LifecycleManager, LifecycleState};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Mutex, TryLockError},
    thread,
    time::Duration,
};
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

const STATUS_EVENT: &str = "agent-desktop://status";

struct AppState {
    lifecycle: Mutex<LifecycleManager>,
    latest_status: Mutex<DesktopStatus>,
    logs_directory: PathBuf,
}

impl Default for AppState {
    fn default() -> Self {
        let lifecycle = LifecycleManager::default();
        let latest_status = lifecycle.snapshot();
        let logs_directory = lifecycle.logs_directory();
        Self {
            lifecycle: Mutex::new(lifecycle),
            latest_status: Mutex::new(latest_status),
            logs_directory,
        }
    }
}

fn publish(app: &AppHandle, status: &DesktopStatus) {
    let changed = app
        .state::<AppState>()
        .latest_status
        .lock()
        .map(|mut latest| update_latest_status(&mut latest, status))
        .unwrap_or(true);
    if changed {
        if let Err(error) = app.emit(STATUS_EVENT, status) {
            eprintln!("could not publish Agent desktop status: {error}");
        }
    }
}

fn update_latest_status(latest: &mut DesktopStatus, status: &DesktopStatus) -> bool {
    if *latest == *status {
        false
    } else {
        *latest = status.clone();
        true
    }
}

fn poisoned_status(app: &AppHandle) -> String {
    let message =
        "desktop lifecycle state is unavailable after an internal failure; restart MoltNet Agent";
    let mut status = app
        .state::<AppState>()
        .latest_status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default();
    status.state = LifecycleState::Failed;
    status.message = message.into();
    publish(app, &status);
    eprintln!("{message}");
    message.into()
}

fn lifecycle_lock_error<T>(error: TryLockError<T>) -> String {
    match error {
        TryLockError::WouldBlock => {
            "another desktop lifecycle operation is already in progress".into()
        }
        TryLockError::Poisoned(_) => {
            "desktop lifecycle state is unavailable after an internal failure".into()
        }
    }
}

fn operate(
    app: &AppHandle,
    operation: impl FnOnce(&mut LifecycleManager) -> Result<DesktopStatus, String>,
) -> Result<DesktopStatus, String> {
    operate_with_pending(app, None, operation)
}

/// `operate`, announcing the transition it is about to run.
///
/// `operation` holds the lifecycle lock for its whole duration - a start runs
/// up to MAX_START_ATTEMPTS * START_TIMEOUT and a stop up to STOP_TIMEOUT - and
/// the snapshot is only published once it returns. The tray refresh worker
/// reads `latest_status` and skips on `WouldBlock`, so without an interim
/// publish it keeps the pre-operation label for the whole run: muda checks the
/// toggle immediately while the menu still reads "Stopped".
fn operate_with_pending(
    app: &AppHandle,
    pending: Option<LifecycleState>,
    operation: impl FnOnce(&mut LifecycleManager) -> Result<DesktopStatus, String>,
) -> Result<DesktopStatus, String> {
    let state = app.state::<AppState>();
    let result = {
        let mut lifecycle = match state.lifecycle.try_lock() {
            Ok(lifecycle) => lifecycle,
            Err(TryLockError::WouldBlock) => {
                return Err("another desktop lifecycle operation is already in progress".into())
            }
            Err(TryLockError::Poisoned(_)) => return Err(poisoned_status(app)),
        };
        // Published only once the lock is ours, so a rejected concurrent
        // request never announces a transition that will not happen.
        if let Some(pending) = pending {
            let mut interim = lifecycle.snapshot();
            interim.state = pending;
            publish(app, &interim);
        }
        let result = operation(&mut lifecycle);
        let snapshot = lifecycle.snapshot();
        publish(app, &snapshot);
        result.map(|_| snapshot)
    };
    result
}

async fn operate_async(
    app: AppHandle,
    pending: Option<LifecycleState>,
    operation: fn(&mut LifecycleManager) -> Result<DesktopStatus, String>,
) -> Result<DesktopStatus, String> {
    tauri::async_runtime::spawn_blocking(move || operate_with_pending(&app, pending, operation))
        .await
        .map_err(|_| "Desktop lifecycle worker failed".to_string())?
}

fn stop_and_exit(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let result = match state.lifecycle.lock() {
        Ok(mut lifecycle) => {
            let result = lifecycle.stop_server();
            let snapshot = lifecycle.snapshot();
            publish(app, &snapshot);
            result.map(|_| ())
        }
        Err(_) => Err(poisoned_status(app)),
    };
    app.exit(if result.is_ok() { 0 } else { 1 });
    result
}

/// Read the run catalogue for one local identity.
///
/// The renderer names an identity and receives JSON. It never sees the control
/// token: the grant stays in the lifecycle manager and is applied here, in
/// native code, on the way out.
#[tauri::command]
async fn desktop_catalogue(
    state: State<'_, AppState>,
    identity: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(
            connection,
            &format!("/v1/catalogue?identity={}", urlencode(&identity)),
        )
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable catalogue: {error}"))
}

#[tauri::command]
async fn desktop_control_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(connection, "/v1/status")
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|_| "The Agent Server returned an unreadable status".to_string())
}

#[tauri::command]
async fn desktop_connection_settings(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(connection, "/v1/native/connection-settings")
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|_| "The Agent Server returned unreadable connection settings".to_string())
}

#[tauri::command]
async fn desktop_apply_connection_settings(
    app: AppHandle,
    overrides: serde_json::Value,
) -> Result<DesktopStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        operate(&app, |lifecycle| {
            let connection = lifecycle
                .control_connection()
                .ok_or("Start the Agent Server before changing its connection settings")?;
            control::post(
                connection,
                "/v1/native/connection-settings",
                &overrides.to_string(),
            )?;
            lifecycle.stop_server()?;
            lifecycle.start_server()
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_operator_configured(state: State<'_, AppState>) -> Result<bool, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(connection, "/oauth/metadata")
    })
    .await?;
    let metadata: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| "The Agent Server returned unreadable operator metadata".to_string())?;
    Ok(metadata
        .get("operatorConfigured")
        .and_then(|value| value.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
async fn desktop_operator_sign_in(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    with_control_connection(&state, move |connection| {
        control::post(connection, "/v1/operator/sign-in", "{}")
    })
    .await?;
    show_status(&app);
    Ok(())
}

#[tauri::command]
async fn desktop_cancel_operator_approval(state: State<'_, AppState>) -> Result<(), String> {
    with_control_connection(&state, move |connection| {
        control::post(connection, "/v1/operator/cancel", "{}")
    })
    .await?;
    Ok(())
}

#[tauri::command]
async fn desktop_enroll_team(
    app: AppHandle,
    state: State<'_, AppState>,
    identity: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let payload =
        serde_json::to_string(&request).map_err(|_| "Could not encode enrollment".to_string())?;
    let body = with_control_connection(&state, move |connection| {
        control::post(
            connection,
            &format!("/v1/agents/{}/teams", urlencode(&identity)),
            &payload,
        )
    })
    .await?;
    let metadata = control::enrollment_metadata(&body)?;
    show_status(&app);
    Ok(metadata)
}

/// Run `operation` with the grant for the currently running server.
async fn with_control_connection(
    state: &State<'_, AppState>,
    operation: impl FnOnce(&control::NativeConnection) -> Result<String, String> + Send + 'static,
) -> Result<String, String> {
    let connection = {
        // `try_lock`, not `lock`: this runs on a tokio worker, and `operate`
        // holds this mutex for the whole of a start (<=24s) or stop (<=17s).
        // Blocking here parks a worker per polling command, so on a small
        // runtime every poller stalls for the duration. Failing fast is
        // recoverable - the callers already poll on an interval.
        let lifecycle = state.lifecycle.try_lock().map_err(lifecycle_lock_error)?;
        lifecycle
            .control_connection()
            .cloned()
            .ok_or_else(|| "the Agent Server is not running".to_string())?
    };
    tauri::async_runtime::spawn_blocking(move || operation(&connection))
        .await
        .map_err(|_| "Local control task failed".to_string())?
}

/// Percent-encode a query value. Identity aliases are already constrained, but
/// the encoding is what makes that a belt rather than the only control.
fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// Start a polling run. The renderer supplies the composed spec; the grant is
/// applied here.
#[tauri::command]
async fn desktop_start_run(
    state: State<'_, AppState>,
    spec: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let payload = serde_json::to_string(&spec)
        .map_err(|error| format!("the run could not be encoded: {error}"))?;
    let body = with_control_connection(&state, move |connection| {
        control::post(connection, "/v1/runs", &payload)
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable run: {error}"))
}

/// Read a bounded log snapshot; the native grant never enters the renderer.
#[tauri::command]
async fn desktop_run_logs(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(
            connection,
            &format!("/v1/runs/{}/logs/snapshot", urlencode(&run_id)),
        )
    })
    .await?;
    serde_json::from_str(&body).map_err(|_| "The Agent Server returned unreadable logs".to_string())
}

/// Stop a run this machine supervises.
#[tauri::command]
async fn desktop_stop_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::delete(connection, &format!("/v1/runs/{}", urlencode(&run_id)))
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable run: {error}"))
}

/// Subscriptions this machine can sign in to, and whether it already has.
#[tauri::command]
async fn desktop_subscriptions(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(connection, "/v1/subscriptions")
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned unreadable subscriptions: {error}"))
}

/// Begin a provider device-authorization flow.
#[tauri::command]
async fn desktop_start_subscription_login(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::post(
            connection,
            &format!("/v1/subscriptions/{}/login", urlencode(&provider_id)),
            "{}",
        )
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable sign-in: {error}"))
}

/// Poll a device-authorization flow for completion.
#[tauri::command]
async fn desktop_subscription_login_status(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(
            connection,
            &format!("/v1/subscriptions/{}/login", urlencode(&provider_id)),
        )
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable sign-in: {error}"))
}

/// Abandon a device-authorization flow the operator gave up on.
#[tauri::command]
async fn desktop_cancel_subscription_login(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<(), String> {
    with_control_connection(&state, move |connection| {
        control::delete(
            connection,
            &format!("/v1/subscriptions/{}/login", urlencode(&provider_id)),
        )
    })
    .await?;
    Ok(())
}

/// Open a provider sign-in page. Native code can do this after an await;
/// a browser cannot, because popup blockers eat a window opened outside the
/// click gesture.
#[tauri::command]
async fn desktop_open_sign_in(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || lifecycle::open_verification_url(&url))
        .await
        .map_err(|_| "Could not open the sign-in page".to_string())?
}

/// Providers configured on this machine.
///
/// The response carries `hasApiKey` booleans, never a key: the server does not
/// echo secrets back, so a configured credential cannot be read out of the
/// WebView even by the surface that wrote it.
#[tauri::command]
async fn desktop_providers(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::get(connection, "/v1/providers")
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned unreadable providers: {error}"))
}

/// Configure a provider, optionally supplying an API key.
///
/// The key is written straight through to the server, which stores it in the
/// local secret provider. Nothing here logs or retains it.
#[tauri::command]
async fn desktop_put_provider(
    state: State<'_, AppState>,
    provider_id: String,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let payload = serde_json::to_string(&config)
        .map_err(|error| format!("the provider could not be encoded: {error}"))?;
    let body = with_control_connection(&state, move |connection| {
        control::put(
            connection,
            &format!("/v1/providers/{}", urlencode(&provider_id)),
            &payload,
        )
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable provider: {error}"))
}

/// Discover models through the server, using its protected provider credentials.
#[tauri::command]
async fn desktop_discover_provider_models(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_connection(&state, move |connection| {
        control::post(
            connection,
            &format!("/v1/providers/{}/discover-models", urlencode(&provider_id)),
            "{}",
        )
    })
    .await?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned unreadable models: {error}"))
}

/// Remove a provider and the API key held for it on this machine.
#[tauri::command]
async fn desktop_delete_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<(), String> {
    with_control_connection(&state, move |connection| {
        control::delete(
            connection,
            &format!("/v1/providers/{}", urlencode(&provider_id)),
        )
    })
    .await?;
    Ok(())
}

#[tauri::command]
fn desktop_status(state: State<'_, AppState>) -> Result<DesktopStatus, String> {
    state
        .latest_status
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "desktop status lock was poisoned".into())
}

#[tauri::command]
async fn install_agent(app: AppHandle) -> Result<DesktopStatus, String> {
    operate_async(
        app,
        Some(LifecycleState::Installing),
        LifecycleManager::install_agent,
    )
    .await
}

#[tauri::command]
async fn retry_server(app: AppHandle) -> Result<DesktopStatus, String> {
    operate_async(app, Some(LifecycleState::Starting), LifecycleManager::retry).await
}

#[tauri::command]
async fn start_agent_server(app: AppHandle) -> Result<DesktopStatus, String> {
    operate_async(
        app,
        Some(LifecycleState::Starting),
        LifecycleManager::start_server,
    )
    .await
}

#[tauri::command]
async fn stop_agent_server(app: AppHandle) -> Result<DesktopStatus, String> {
    operate_async(
        app,
        Some(LifecycleState::Stopping),
        LifecycleManager::stop_server,
    )
    .await
}

#[tauri::command]
async fn check_for_agent_updates(app: AppHandle) -> Result<DesktopStatus, String> {
    operate_async(app, None, LifecycleManager::check_for_updates).await
}

#[tauri::command]
async fn install_agent_update(app: AppHandle) -> Result<DesktopStatus, String> {
    operate_async(
        app,
        Some(LifecycleState::Installing),
        LifecycleManager::install_update,
    )
    .await
}

#[tauri::command]
async fn open_logs(state: State<'_, AppState>) -> Result<(), String> {
    let directory = state.logs_directory.clone();
    tauri::async_runtime::spawn_blocking(move || lifecycle::open_logs(&directory))
        .await
        .map_err(|_| "Could not open logs".to_string())?
}

#[tauri::command]
async fn remove_agent_bundle(app: AppHandle) -> Result<DesktopStatus, String> {
    operate_async(app, None, LifecycleManager::remove_bundle).await
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateCheck {
    available_version: Option<String>,
    message: String,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DesktopUpdateInstaller {
    Deb,
    BuiltIn,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn desktop_update_installer(
    linux: bool,
    bundle_type: Option<BundleType>,
) -> Result<DesktopUpdateInstaller, String> {
    if !linux {
        return Ok(DesktopUpdateInstaller::BuiltIn);
    }
    match bundle_type {
        Some(BundleType::Deb) => Ok(DesktopUpdateInstaller::Deb),
        Some(BundleType::AppImage) => Ok(DesktopUpdateInstaller::BuiltIn),
        _ => Err("In-app Linux updates require an installed deb or AppImage".into()),
    }
}

fn record_desktop_log(app: &AppHandle, message: &str) {
    if let Ok(lifecycle) = app.state::<AppState>().lifecycle.try_lock() {
        lifecycle.push_log(message);
    }
    eprintln!("{message}");
}

fn record_desktop_update_error(
    app: &AppHandle,
    stage: &str,
    error: impl std::fmt::Display,
) -> String {
    let message = format!("Desktop update {stage} failed: {error}");
    record_desktop_log(app, &message);
    message
}

fn restart_after_success(result: Result<(), String>, restart: impl FnOnce()) -> Result<(), String> {
    result?;
    restart();
    Ok(())
}

fn development_update_check(is_debug: bool) -> Option<DesktopUpdateCheck> {
    is_debug.then(|| DesktopUpdateCheck {
        available_version: None,
        message: "App updates are checked only by signed MoltNet Agent builds.".into(),
    })
}

#[tauri::command]
async fn check_for_desktop_update(app: AppHandle) -> Result<DesktopUpdateCheck, String> {
    if let Some(check) = development_update_check(cfg!(debug_assertions)) {
        return Ok(check);
    }
    let update = app
        .updater()
        .map_err(|error| record_desktop_update_error(&app, "setup", error))?
        .check()
        .await
        .map_err(|error| record_desktop_update_error(&app, "check", error))?;
    Ok(DesktopUpdateCheck {
        available_version: update.map(|update| update.version),
        message: "This signed MoltNet Agent build is up to date.".into(),
    })
}

#[tauri::command]
async fn install_desktop_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| record_desktop_update_error(&app, "setup", error))?
        .check()
        .await
        .map_err(|error| record_desktop_update_error(&app, "check", error))?
        .ok_or_else(|| "MoltNet Agent is already up to date".to_string())?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| record_desktop_update_error(&app, "download", error))?;
    // download() verifies the updater signature before either installer receives bytes.
    let install = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        match desktop_update_installer(true, tauri::utils::platform::bundle_type())? {
            DesktopUpdateInstaller::Deb => return linux_setup::install_deb(&bytes),
            DesktopUpdateInstaller::BuiltIn => {}
        }
        update.install(bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| record_desktop_update_error(&app, "worker", error))?
    .map_err(|error| record_desktop_update_error(&app, "install", error));
    restart_after_success(install, || app.restart())
}

fn show_status(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn start_lifecycle(app: AppHandle) {
    let initialize = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = operate(&initialize, LifecycleManager::initialize);
    });

    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let state = app.state::<AppState>();
        let action = match state.lifecycle.try_lock() {
            Ok(mut lifecycle) => {
                let action = lifecycle.inspect_exit();
                let snapshot = lifecycle.snapshot();
                publish(&app, &snapshot);
                action
            }
            Err(TryLockError::WouldBlock) => continue,
            Err(TryLockError::Poisoned(_)) => {
                let _ = poisoned_status(&app);
                break;
            }
        };
        if action == ExitAction::Retry {
            let retry = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let state = retry.state::<AppState>();
                let result = match state.lifecycle.lock() {
                    Ok(mut lifecycle) => {
                        let result = lifecycle.retry_after_exit();
                        let snapshot = lifecycle.snapshot();
                        publish(&retry, &snapshot);
                        result
                    }
                    Err(_) => {
                        let error = poisoned_status(&retry);
                        eprintln!("automatic Agent Server recovery failed: {error}");
                        return;
                    }
                };
                if let Err(error) = result {
                    eprintln!("automatic Agent Server recovery failed: {error}");
                }
            });
        }
    });
}

#[tauri::command]
async fn desktop_linux_setup() -> Result<linux_setup::LinuxSetup, String> {
    tauri::async_runtime::spawn_blocking(linux_setup::inspect)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_repair_linux_setup(
    app: AppHandle,
    repair: linux_setup::Repair,
) -> Result<linux_setup::LinuxSetup, String> {
    let result = tauri::async_runtime::spawn_blocking(move || linux_setup::repair(repair))
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = &result {
        record_desktop_log(&app, &format!("Linux system setup failed: {error}"));
    }
    result
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            desktop_linux_setup,
            desktop_repair_linux_setup,
            desktop_catalogue,
            desktop_control_status,
            desktop_enroll_team,
            desktop_operator_sign_in,
            desktop_operator_configured,
            desktop_connection_settings,
            desktop_apply_connection_settings,
            desktop_cancel_operator_approval,
            desktop_start_run,
            desktop_stop_run,
            desktop_run_logs,
            desktop_providers,
            desktop_put_provider,
            desktop_discover_provider_models,
            desktop_delete_provider,
            desktop_subscriptions,
            desktop_start_subscription_login,
            desktop_subscription_login_status,
            desktop_cancel_subscription_login,
            desktop_open_sign_in,
            install_agent,
            retry_server,
            start_agent_server,
            stop_agent_server,
            check_for_agent_updates,
            install_agent_update,
            open_logs,
            remove_agent_bundle,
            check_for_desktop_update,
            install_desktop_update
        ])
        .setup(|app| {
            tray::install(app)?;
            start_lifecycle(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build MoltNet Agent");

    app.run(|handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            api.prevent_exit();
            let app = handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = stop_and_exit(&app);
            });
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn status_updates_are_emitted_only_when_observable_state_changes() {
        let mut latest = DesktopStatus::default();
        let same = latest.clone();
        assert!(!update_latest_status(&mut latest, &same));

        let mut changed = same;
        changed.message = "new child output".into();
        Arc::make_mut(&mut changed.logs).push_back("line".into());
        assert!(latest.logs.is_empty());
        assert!(update_latest_status(&mut latest, &changed));
        assert_eq!(latest, changed);
    }

    #[test]
    fn announcing_a_transition_is_observable_to_the_tray() {
        // `operate_with_pending` publishes a snapshot whose only difference is
        // `state`. If that stopped counting as a change, the tray would keep
        // the pre-operation label for the whole of a start or stop.
        let mut latest = DesktopStatus {
            state: LifecycleState::Stopped,
            ..DesktopStatus::default()
        };
        let mut interim = latest.clone();
        interim.state = LifecycleState::Starting;
        assert!(update_latest_status(&mut latest, &interim));
        assert_eq!(latest.state, LifecycleState::Starting);
    }

    #[test]
    fn lifecycle_lock_errors_distinguish_contention_from_poisoning() {
        let busy = Mutex::new(());
        let _guard = busy.lock().unwrap();
        assert_eq!(
            lifecycle_lock_error(busy.try_lock().unwrap_err()),
            "another desktop lifecycle operation is already in progress"
        );

        let poisoned = Arc::new(Mutex::new(()));
        let worker = Arc::clone(&poisoned);
        let _ = thread::spawn(move || {
            let _guard = worker.lock().unwrap();
            panic!("poison lifecycle lock for the test");
        })
        .join();
        assert_eq!(
            lifecycle_lock_error(poisoned.try_lock().unwrap_err()),
            "desktop lifecycle state is unavailable after an internal failure"
        );
    }

    #[test]
    fn development_builds_do_not_contact_the_signed_update_channel() {
        assert_eq!(
            development_update_check(true),
            Some(DesktopUpdateCheck {
                available_version: None,
                message: "App updates are checked only by signed MoltNet Agent builds.".into(),
            })
        );
        assert_eq!(development_update_check(false), None);
    }

    #[test]
    fn desktop_update_installer_matches_the_running_bundle() {
        assert_eq!(
            desktop_update_installer(true, Some(BundleType::Deb)),
            Ok(DesktopUpdateInstaller::Deb)
        );
        assert_eq!(
            desktop_update_installer(true, Some(BundleType::AppImage)),
            Ok(DesktopUpdateInstaller::BuiltIn)
        );
        assert!(desktop_update_installer(true, None).is_err());
        assert!(desktop_update_installer(true, Some(BundleType::Dmg)).is_err());
        assert_eq!(
            desktop_update_installer(false, None),
            Ok(DesktopUpdateInstaller::BuiltIn)
        );
    }

    #[test]
    fn failed_desktop_install_never_restarts_the_app() {
        let mut restarted = false;
        let failure = restart_after_success(Err("install failed".into()), || restarted = true);
        assert_eq!(failure, Err("install failed".into()));
        assert!(!restarted);

        restart_after_success(Ok(()), || restarted = true).unwrap();
        assert!(restarted);
    }
}
