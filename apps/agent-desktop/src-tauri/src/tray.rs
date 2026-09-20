//! Native, read-only machine overview with explicit lifecycle actions.
//! Refreshes use the existing process grant; no OAuth exchange is involved.
use crate::{control, lifecycle, operate, show_status, stop_and_exit, AppState};
use lifecycle::{DesktopStatus, LifecycleManager, LifecycleState};
use serde_json::Value;
use std::{thread, time::Duration};
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

const TRAY_ID: &str = "moltnet-overview";
const MAX_ITEMS: usize = 20;

#[derive(Clone, Default, PartialEq)]
struct Overview {
    status: DesktopStatus,
    runtime: Option<Value>,
    operator: Option<bool>,
    catalogue: Option<Value>,
}

fn label(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_control())
        .take(90)
        .collect()
}

fn text<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or("")
}

fn rows<'a>(value: &'a Value, field: &str) -> Vec<&'a Value> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|list| list.iter().collect())
        .unwrap_or_default()
}

fn running(state: LifecycleState) -> bool {
    matches!(
        state,
        LifecycleState::Running | LifecycleState::UpdateAvailable
    )
}

fn state_label(status: &DesktopStatus) -> &'static str {
    match status.state {
        LifecycleState::Running | LifecycleState::UpdateAvailable => "Agent Server — Running",
        LifecycleState::Stopped | LifecycleState::Removed => "Agent Server — Stopped",
        LifecycleState::Starting => "Agent Server — Starting…",
        LifecycleState::Stopping => "Agent Server — Stopping…",
        LifecycleState::NeedsInstall => "Agent Server — Not installed",
        LifecycleState::NeedsTrust => "Agent Server — Trust required",
        LifecycleState::Installing => "Agent Server — Installing…",
        LifecycleState::Failed => "Agent Server — Needs attention",
        LifecycleState::Checking => "Agent Server — Checking…",
    }
}

fn detail(app: &AppHandle, menu: &Submenu<tauri::Wry>, value: &str) -> tauri::Result<()> {
    menu.append(
        &MenuItemBuilder::new(label(value))
            .enabled(false)
            .build(app)?,
    )
}

fn menu(app: &AppHandle, overview: &Overview) -> tauri::Result<Menu<tauri::Wry>> {
    let status = &overview.status;
    let active = running(status.state);
    let toggle = CheckMenuItemBuilder::with_id("toggle-server", state_label(status))
        .checked(active)
        .enabled(
            active
                || matches!(
                    status.state,
                    LifecycleState::Stopped | LifecycleState::Failed
                ),
        )
        .build(app)?;
    let runtime = overview.runtime.as_ref().unwrap_or(&Value::Null);
    let identity = text(runtime, "selectedIdentity");
    let identities = SubmenuBuilder::new(
        app,
        if identity.is_empty() {
            "Identities".into()
        } else {
            format!("Identity — {}", label(identity))
        },
    )
    .build()?;
    detail(
        app,
        &identities,
        match overview.operator {
            Some(true) => "Local operator signed in",
            Some(false) => "Local operator not signed in",
            None => "Local operator status unavailable",
        },
    )?;
    let entries = rows(runtime, "identities");
    for entry in entries.iter().take(MAX_ITEMS) {
        let alias = text(entry, "alias");
        identities.append(
            &CheckMenuItemBuilder::new(label(alias))
                .checked(alias == identity)
                .enabled(false)
                .build(app)?,
        )?;
    }
    if entries.is_empty() {
        detail(app, &identities, "No local identities available")?;
    }
    identities.append(&MenuItemBuilder::with_id("teams", "Manage identities…").build(app)?)?;

    let teams = SubmenuBuilder::new(app, "Teams").build()?;
    if let Some(catalogue) = &overview.catalogue {
        for team in rows(catalogue, "teams").into_iter().take(MAX_ITEMS) {
            let name = text(team, "teamName");
            let title = if name.is_empty() {
                text(team, "teamId")
            } else {
                name
            };
            let available = team
                .get("available")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let submenu = SubmenuBuilder::new(
                app,
                format!(
                    "{} — {}",
                    label(title),
                    if available {
                        "Ready"
                    } else {
                        "Needs attention"
                    }
                ),
            )
            .build()?;
            detail(app, &submenu, text(team, "teamId"))?;
            if let Some(credential) = team.get("credential") {
                let expiry = text(credential, "expiresAt");
                if !expiry.is_empty() {
                    detail(app, &submenu, &format!("Key expires: {expiry}"))?;
                }
                let verified = text(credential, "verifiedAt");
                if !verified.is_empty() {
                    detail(app, &submenu, &format!("Last verified: {verified}"))?;
                }
            }
            for blocker in rows(team, "blockers").into_iter().take(3) {
                detail(app, &submenu, text(blocker, "message"))?;
            }
            teams.append(&submenu)?;
        }
        if rows(catalogue, "teams").is_empty() {
            detail(app, &teams, "No teams enrolled")?;
        }
    } else {
        detail(app, &teams, "Team details unavailable")?;
    }
    teams.append(&MenuItemBuilder::with_id("teams", "Manage team access…").build(app)?)?;

    let providers = SubmenuBuilder::new(app, "Providers").build()?;
    let configured = runtime.get("providers").and_then(Value::as_object);
    if let Some(entries) = configured {
        for (id, provider) in entries.iter().take(MAX_ITEMS) {
            let submenu = SubmenuBuilder::new(app, label(id)).build()?;
            detail(app, &submenu, text(provider, "baseUrl"))?;
            detail(
                app,
                &submenu,
                &format!("{} models configured", rows(provider, "models").len()),
            )?;
            detail(
                app,
                &submenu,
                if provider.get("hasApiKey").and_then(Value::as_bool) == Some(true) {
                    "API key stored on this Mac"
                } else {
                    "No API key stored"
                },
            )?;
            providers.append(&submenu)?;
        }
    }
    let subscriptions: Vec<_> = rows(runtime, "subscriptions")
        .into_iter()
        .filter(|entry| entry.get("connected").and_then(Value::as_bool) == Some(true))
        .collect();
    for subscription in &subscriptions {
        detail(
            app,
            &providers,
            &format!("{} — Signed in", text(subscription, "name")),
        )?;
    }
    if configured.map(|entries| entries.is_empty()).unwrap_or(true) && subscriptions.is_empty() {
        detail(
            app,
            &providers,
            if overview.runtime.is_some() {
                "No providers configured"
            } else {
                "Provider details unavailable"
            },
        )?;
    }
    providers.append(&MenuItemBuilder::with_id("providers", "Configure providers…").build(app)?)?;

    let active_runs: Vec<_> = rows(runtime, "runs")
        .into_iter()
        .filter(|run| run.get("active").and_then(Value::as_bool) == Some(true))
        .collect();
    let runs = SubmenuBuilder::new(
        app,
        if overview.runtime.is_some() {
            format!("Running work — {}", active_runs.len())
        } else {
            "Running work".into()
        },
    )
    .build()?;
    for run in active_runs.iter().take(MAX_ITEMS) {
        detail(
            app,
            &runs,
            &format!("{} · {}", text(run, "agent"), text(run, "teamId")),
        )?;
    }
    if active_runs.is_empty() {
        detail(
            app,
            &runs,
            if overview.runtime.is_some() {
                "No active runs"
            } else {
                "Run status unavailable"
            },
        )?;
    }
    runs.append(&MenuItemBuilder::with_id("runs", "Open run centre…").build(app)?)?;

    let settings = SubmenuBuilder::new(app, "Settings")
        .text("logs", "Open Logs")
        .text("update", "Check for Updates")
        .text("remove", "Remove Agent Bundle…")
        .build()?;
    if let Some(version) = &status.installed_version {
        detail(app, &settings, &format!("Agent bundle {version}"))?;
    }
    let mut builder = MenuBuilder::new(app).item(&toggle);
    if active && overview.runtime.is_none() {
        builder = builder.item(
            &MenuItemBuilder::new("Local details could not be refreshed")
                .enabled(false)
                .build(app)?,
        );
    }
    builder
        .separator()
        .item(&identities)
        .item(&teams)
        .item(&providers)
        .item(&runs)
        .separator()
        .item(&settings)
        .text("show", "Open MoltNet…")
        .text("console", "Open Console")
        .separator()
        .text("quit", "Quit and Stop Server")
        .build()
}

pub fn install(app: &mut tauri::App) -> tauri::Result<()> {
    let snapshot = app
        .state::<AppState>()
        .latest_status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default();
    let initial = Overview {
        status: snapshot,
        ..Overview::default()
    };
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("MoltNet Agent")
        .menu(&menu(app.handle(), &initial)?)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_status(app),
            "teams" | "providers" | "runs" => {
                show_status(app);
                let _ = app.emit("agent-desktop://navigate", event.id().as_ref());
            }
            "toggle-server" => {
                let handle = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let active = handle
                        .state::<AppState>()
                        .latest_status
                        .lock()
                        .map(|status| running(status.state))
                        .unwrap_or(false);
                    let result = if active {
                        operate(&handle, LifecycleManager::stop_server)
                    } else {
                        operate(&handle, LifecycleManager::start_server)
                    };
                    if result.is_err() {
                        show_status(&handle);
                    }
                });
            }
            "console" => {
                let _ = lifecycle::open_console();
            }
            "logs" => {
                let _ = lifecycle::open_logs(&app.state::<AppState>().logs_directory);
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
                let _ = app.emit("agent-desktop://request-remove", ());
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
        tray = tray.icon(icon.clone()).icon_as_template(true);
    }
    tray.build(app)?;
    start_refresh(app.handle().clone());
    Ok(())
}

fn read(app: &AppHandle, path: &str) -> Option<Value> {
    // This runs on the tray worker, never on the main thread. Release the
    // lifecycle lock before network I/O so native administration remains live.
    let token = app
        .state::<AppState>()
        .lifecycle
        .lock()
        .ok()?
        .control_token()
        .cloned()?;
    control::get(&token, path)
        .ok()
        .and_then(|body| serde_json::from_str(&body).ok())
}

fn start_refresh(app: AppHandle) {
    thread::spawn(move || {
        let mut previous = Overview::default();
        let mut tick = 0usize;
        let mut failures = 0u32;
        loop {
            // Native-only refresh remains available with the window hidden.
            let mut status = app
                .state::<AppState>()
                .latest_status
                .lock()
                .map(|status| status.clone())
                .unwrap_or_default();
            // Log lines and explanatory messages do not change menu content.
            // Ignoring them avoids rebuilding an open menu on each log write.
            status.logs.clear();
            status.message.clear();
            let mut next = Overview {
                status,
                ..Overview::default()
            };
            if running(next.status.state)
                && (tick.is_multiple_of(8usize << failures.min(2))
                    || !running(previous.status.state))
            {
                next.runtime = read(&app, "/v1/status");
                if let Some(runtime) = &next.runtime {
                    failures = 0;
                    next.operator = read(&app, "/oauth/metadata")
                        .and_then(|value| value.get("operatorConfigured").and_then(Value::as_bool));
                    let identity = text(runtime, "selectedIdentity");
                    let old_identity = previous
                        .runtime
                        .as_ref()
                        .map(|old| text(old, "selectedIdentity"))
                        .unwrap_or("");
                    if !identity.is_empty() {
                        next.catalogue = if tick.is_multiple_of(32)
                            || identity != old_identity
                            || previous.catalogue.is_none()
                        {
                            read(
                                &app,
                                &format!("/v1/catalogue?identity={}", crate::urlencode(identity)),
                            )
                        } else {
                            previous.catalogue.clone()
                        };
                    }
                } else {
                    failures = failures.saturating_add(1);
                }
            } else if running(next.status.state) {
                next.runtime = previous.runtime.clone();
                next.operator = previous.operator;
                next.catalogue = previous.catalogue.clone();
            }
            if next != previous {
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if let Ok(menu) = menu(&app, &next) {
                        let _ = tray.set_menu(Some(menu));
                    }
                    let _ = tray.set_tooltip(Some(state_label(&next.status)));
                }
                previous = next;
            }
            tick = tick.wrapping_add(1);
            thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updating_bundle_is_still_a_running_server() {
        assert!(running(LifecycleState::UpdateAvailable));
        assert!(!running(LifecycleState::NeedsTrust));
        assert!(!running(LifecycleState::Stopped));
    }

    #[test]
    fn menu_labels_bound_untrusted_names_and_remove_control_characters() {
        assert_eq!(label("agent\nname\t"), "agentname");
        assert_eq!(label(&"é".repeat(120)).chars().count(), 90);
    }
}
