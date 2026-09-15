mod lifecycle;

use lifecycle::{DesktopStatus, ExitAction, LifecycleManager};
use std::{sync::Mutex, thread, time::Duration};
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
}

impl Default for AppState {
    fn default() -> Self {
        let lifecycle = LifecycleManager::default();
        let latest_status = lifecycle.snapshot();
        Self {
            lifecycle: Mutex::new(lifecycle),
            latest_status: Mutex::new(latest_status),
        }
    }
}

fn publish(app: &AppHandle, status: &DesktopStatus) {
    if let Ok(mut latest) = app.state::<AppState>().latest_status.lock() {
        *latest = status.clone();
    }
    if let Err(error) = app.emit(STATUS_EVENT, status) {
        eprintln!("could not publish Agent desktop status: {error}");
    }
}

fn operate(
    app: &AppHandle,
    operation: impl FnOnce(&mut LifecycleManager) -> Result<DesktopStatus, String>,
) -> Result<DesktopStatus, String> {
    let state = app.state::<AppState>();
    let (result, snapshot) = {
        let mut lifecycle = state.lifecycle.try_lock().map_err(|_| {
            "another desktop lifecycle operation is already in progress".to_string()
        })?;
        let result = operation(&mut lifecycle);
        (result, lifecycle.snapshot())
    };
    publish(app, &snapshot);
    result.map(|_| snapshot)
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
fn check_for_agent_updates(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::check_for_updates)
}

#[tauri::command]
fn install_agent_update(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::install_update)
}

#[tauri::command]
fn open_console(state: State<'_, AppState>) -> Result<(), String> {
    state
        .lifecycle
        .try_lock()
        .map_err(|_| "another desktop lifecycle operation is already in progress".to_string())?
        .open_console()
}

#[tauri::command]
fn open_logs(state: State<'_, AppState>) -> Result<(), String> {
    state
        .lifecycle
        .try_lock()
        .map_err(|_| "another desktop lifecycle operation is already in progress".to_string())?
        .open_logs()
}

#[tauri::command]
fn remove_agent_bundle(app: AppHandle, remove_local_ca: bool) -> Result<DesktopStatus, String> {
    operate(&app, |lifecycle| lifecycle.remove_bundle(remove_local_ca))
}

#[tauri::command]
fn remove_local_trust(app: AppHandle) -> Result<DesktopStatus, String> {
    operate(&app, LifecycleManager::remove_trust)
}

#[tauri::command]
fn quit_and_stop(app: AppHandle) -> Result<(), String> {
    let result = operate(&app, LifecycleManager::stop_server).map(|_| ());
    app.exit(if result.is_ok() { 0 } else { 1 });
    result
}

#[tauri::command]
async fn check_for_desktop_update(app: AppHandle) -> Result<Option<String>, String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(update.map(|update| update.version))
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
                let state = app.state::<AppState>();
                if let Ok(lifecycle) = state.lifecycle.try_lock() {
                    if let Err(error) = lifecycle.open_console() {
                        eprintln!("could not open MoltNet Console: {error}");
                    }
                };
            }
            "logs" => {
                let state = app.state::<AppState>();
                if let Ok(lifecycle) = state.lifecycle.try_lock() {
                    if let Err(error) = lifecycle.open_logs() {
                        eprintln!("could not open Agent Server logs: {error}");
                    }
                };
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
                    let result = operate(&handle, LifecycleManager::stop_server);
                    handle.exit(if result.is_ok() { 0 } else { 1 });
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
        let inspected = state.lifecycle.try_lock().ok().map(|mut lifecycle| {
            let action = lifecycle.inspect_exit();
            let snapshot = lifecycle.snapshot();
            (action, snapshot)
        });
        let Some((action, snapshot)) = inspected else {
            continue;
        };
        if action != ExitAction::None {
            publish(&app, &snapshot);
        }
        if action == ExitAction::Retry {
            let retry = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = operate(&retry, LifecycleManager::retry_after_exit);
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
            install_agent,
            approve_local_trust,
            retry_server,
            check_for_agent_updates,
            install_agent_update,
            open_console,
            open_logs,
            remove_agent_bundle,
            remove_local_trust,
            quit_and_stop,
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
                let result = operate(&app, LifecycleManager::stop_server);
                app.exit(if result.is_ok() { 0 } else { 1 });
            });
        }
        _ => {}
    });
}
