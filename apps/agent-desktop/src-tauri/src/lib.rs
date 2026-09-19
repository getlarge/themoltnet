mod control;
mod lifecycle;

#[cfg(test)]
#[path = "../build_support.rs"]
mod build_support;

use lifecycle::{DesktopStatus, ExitAction, LifecycleManager};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Mutex, TryLockError},
    thread,
    time::Duration,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};
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
    status.state = lifecycle::LifecycleState::Failed;
    status.message = message.into();
    publish(app, &status);
    eprintln!("{message}");
    message.into()
}

#[cfg(test)]
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
    let state = app.state::<AppState>();
    let result = {
        let mut lifecycle = match state.lifecycle.try_lock() {
            Ok(lifecycle) => lifecycle,
            Err(TryLockError::WouldBlock) => {
                return Err("another desktop lifecycle operation is already in progress".into())
            }
            Err(TryLockError::Poisoned(_)) => return Err(poisoned_status(app)),
        };
        let result = operation(&mut lifecycle);
        let snapshot = lifecycle.snapshot();
        publish(app, &snapshot);
        result.map(|_| snapshot)
    };
    result
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
fn desktop_catalogue(
    state: State<'_, AppState>,
    identity: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_token(&state, |token| {
        control::get(
            token,
            &format!("/v1/catalogue?identity={}", urlencode(&identity)),
        )
    })?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable catalogue: {error}"))
}

#[tauri::command]
fn desktop_control_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let body = with_control_token(&state, |token| control::get(token, "/v1/status"))?;
    serde_json::from_str(&body)
        .map_err(|_| "The Agent Server returned an unreadable status".to_string())
}

#[tauri::command]
async fn desktop_operator_sign_in(state: State<'_, AppState>) -> Result<(), String> {
    let token = state
        .lifecycle
        .lock()
        .map_err(|_| "desktop lifecycle lock was poisoned")?
        .control_token()
        .cloned()
        .ok_or("the Agent Server is not running")?;
    tauri::async_runtime::spawn_blocking(move || {
        control::post(&token, "/v1/operator/sign-in", "{}")
    })
    .await
    .map_err(|_| "Sign-in task failed")??;
    Ok(())
}

#[tauri::command]
async fn desktop_enroll_team(
    state: State<'_, AppState>,
    identity: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let payload =
        serde_json::to_string(&request).map_err(|_| "Could not encode enrollment".to_string())?;
    let token = state
        .lifecycle
        .lock()
        .map_err(|_| "desktop lifecycle lock was poisoned")?
        .control_token()
        .cloned()
        .ok_or("the Agent Server is not running")?;
    let body = tauri::async_runtime::spawn_blocking(move || {
        control::post(
            &token,
            &format!("/v1/agents/{}/teams", urlencode(&identity)),
            &payload,
        )
    })
    .await
    .map_err(|_| "Enrollment task failed")??;
    control::enrollment_metadata(&body)
}

/// Run `operation` with the grant for the currently running server.
fn with_control_token(
    state: &State<'_, AppState>,
    operation: impl FnOnce(&control::NativeToken) -> Result<String, String>,
) -> Result<String, String> {
    let lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "desktop lifecycle lock was poisoned".to_string())?;
    let token = lifecycle
        .control_token()
        .ok_or_else(|| "the Agent Server is not running".to_string())?;
    let owned_token = token.clone();
    drop(lifecycle);
    operation(&owned_token)
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
fn desktop_start_run(
    state: State<'_, AppState>,
    spec: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let payload = serde_json::to_string(&spec)
        .map_err(|error| format!("the run could not be encoded: {error}"))?;
    let body = with_control_token(&state, |token| control::post(token, "/v1/runs", &payload))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable run: {error}"))
}

/// Stop a run this machine supervises.
#[tauri::command]
fn desktop_stop_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_token(&state, |token| {
        control::delete(token, &format!("/v1/runs/{}", urlencode(&run_id)))
    })?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable run: {error}"))
}

/// Subscriptions this machine can sign in to, and whether it already has.
#[tauri::command]
fn desktop_subscriptions(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let body = with_control_token(&state, |token| control::get(token, "/v1/subscriptions"))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned unreadable subscriptions: {error}"))
}

/// Begin a provider device-authorization flow.
#[tauri::command]
fn desktop_start_subscription_login(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_token(&state, |token| {
        control::post(
            token,
            &format!("/v1/subscriptions/{}/login", urlencode(&provider_id)),
            "{}",
        )
    })?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable sign-in: {error}"))
}

/// Poll a device-authorization flow for completion.
#[tauri::command]
fn desktop_subscription_login_status(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<serde_json::Value, String> {
    let body = with_control_token(&state, |token| {
        control::get(
            token,
            &format!("/v1/subscriptions/{}/login", urlencode(&provider_id)),
        )
    })?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable sign-in: {error}"))
}

/// Abandon a device-authorization flow the operator gave up on.
#[tauri::command]
fn desktop_cancel_subscription_login(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<(), String> {
    with_control_token(&state, |token| {
        control::delete(
            token,
            &format!("/v1/subscriptions/{}/login", urlencode(&provider_id)),
        )
    })?;
    Ok(())
}

/// Open a provider sign-in page. Native code can do this after an await;
/// a browser cannot, because popup blockers eat a window opened outside the
/// click gesture.
#[tauri::command]
fn desktop_open_sign_in(url: String) -> Result<(), String> {
    lifecycle::open_verification_url(&url)
}

/// Providers configured on this machine.
///
/// The response carries `hasApiKey` booleans, never a key: the server does not
/// echo secrets back, so a configured credential cannot be read out of the
/// WebView even by the surface that wrote it.
#[tauri::command]
fn desktop_providers(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let body = with_control_token(&state, |token| control::get(token, "/v1/providers"))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned unreadable providers: {error}"))
}

/// Configure a provider, optionally supplying an API key.
///
/// The key is written straight through to the server, which stores it in the
/// local secret provider. Nothing here logs or retains it.
#[tauri::command]
fn desktop_put_provider(
    state: State<'_, AppState>,
    provider_id: String,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let payload = serde_json::to_string(&config)
        .map_err(|error| format!("the provider could not be encoded: {error}"))?;
    let body = with_control_token(&state, |token| {
        control::put(
            token,
            &format!("/v1/providers/{}", urlencode(&provider_id)),
            &payload,
        )
    })?;
    serde_json::from_str(&body)
        .map_err(|error| format!("the Agent Server returned an unreadable provider: {error}"))
}

/// Remove a provider and the API key held for it on this machine.
#[tauri::command]
fn desktop_delete_provider(state: State<'_, AppState>, provider_id: String) -> Result<(), String> {
    with_control_token(&state, |token| {
        control::delete(token, &format!("/v1/providers/{}", urlencode(&provider_id)))
    })?;
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
fn install_agent(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::install_agent)
}

#[tauri::command]
fn approve_local_trust(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::approve_trust)
}

#[tauri::command]
fn retry_server(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::retry)
}

#[tauri::command]
fn start_agent_server(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::start_server)
}

#[tauri::command]
fn stop_agent_server(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::stop_server)
}

#[tauri::command]
fn check_for_agent_updates(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::check_for_updates)
}

#[tauri::command]
fn install_agent_update(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::install_update)
}

#[tauri::command]
fn open_console() -> Result<(), String> {
    lifecycle::open_console()
}

#[tauri::command]
fn open_logs(state: State<'_, AppState>) -> Result<(), String> {
    lifecycle::open_logs(&state.logs_directory)
}

#[tauri::command]
fn remove_agent_bundle(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::remove_bundle)
}

#[tauri::command]
fn remove_local_trust(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::remove_trust)
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateCheck {
    available_version: Option<String>,
    message: String,
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
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(DesktopUpdateCheck {
        available_version: update.map(|update| update.version),
        message: "This signed MoltNet Agent build is up to date.".into(),
    })
}

#[tauri::command]
async fn install_desktop_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "MoltNet Agent is already up to date".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart();
}

fn show_status(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "Show Status").build(app)?;
    let console = MenuItemBuilder::with_id("console", "Open Console").build(app)?;
    let logs = MenuItemBuilder::with_id("logs", "Open Logs").build(app)?;
    let update = MenuItemBuilder::with_id("update", "Check for Updates").build(app)?;
    let remove = MenuItemBuilder::with_id("remove", "Remove Agent Bundle").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit and Stop Server").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &console, &logs, &update, &remove, &separator, &quit])
        .build()?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("MoltNet Agent")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_status(app),
            "console" => {
                if let Err(error) = lifecycle::open_console() {
                    eprintln!("could not open MoltNet Console: {error}");
                }
            }
            "logs" => {
                let state = app.state::<AppState>();
                if let Err(error) = lifecycle::open_logs(&state.logs_directory) {
                    eprintln!("could not open Agent Server logs: {error}");
                }
            }
            "update" => {
                show_status(app);
                let handle = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = operate(&handle, LifecycleManager::check_for_updates);
                });
            }
            "remove" => {
                show_status(app);
                if let Err(error) = app.emit("agent-desktop://request-remove", ()) {
                    eprintln!("could not publish Agent bundle removal request: {error}");
                }
            }
            "quit" => {
                let handle = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = stop_and_exit(&handle);
                });
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
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

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            desktop_catalogue,
            desktop_control_status,
            desktop_enroll_team,
            desktop_operator_sign_in,
            desktop_start_run,
            desktop_stop_run,
            desktop_providers,
            desktop_put_provider,
            desktop_delete_provider,
            desktop_subscriptions,
            desktop_start_subscription_login,
            desktop_subscription_login_status,
            desktop_cancel_subscription_login,
            desktop_open_sign_in,
            install_agent,
            approve_local_trust,
            retry_server,
            start_agent_server,
            stop_agent_server,
            check_for_agent_updates,
            install_agent_update,
            open_console,
            open_logs,
            remove_agent_bundle,
            remove_local_trust,
            check_for_desktop_update,
            install_desktop_update
        ])
        .setup(|app| {
            install_tray(app)?;
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
        changed.logs.push("line".into());
        assert!(update_latest_status(&mut latest, &changed));
        assert_eq!(latest, changed);
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
}
