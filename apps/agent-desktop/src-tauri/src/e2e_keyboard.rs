//! Test-build-only AppKit input. The embedded WebDriver emits synthetic DOM
//! KeyboardEvents, which do not perform WebKit's default Tab navigation.
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSEvent, NSEventModifierFlags, NSEventType};
use objc2_foundation::{NSPoint, NSString};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn desktop_e2e_tab(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Missing test window")?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    let title = window.title().map_err(|e| e.to_string())?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.run_on_main_thread(move || {
        let result: Result<(), String> = (|| {
            let main = MainThreadMarker::new().ok_or("Expected AppKit main thread")?;
            let application = NSApplication::sharedApplication(main);
            let window = application.windows().into_iter()
                .find(|candidate| candidate.title().to_string() == title)
                .ok_or("No native test window")?;
            application.activate();
            window.makeKeyAndOrderFront(None);
            let characters = NSString::from_str("\t");
            for kind in [NSEventType::KeyDown, NSEventType::KeyUp] {
                let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                    kind, NSPoint::ZERO, NSEventModifierFlags::empty(), 0.0,
                    window.windowNumber(), None, &characters, &characters, false, 48,
                ).ok_or("Could not construct native Tab event")?;
                window.sendEvent(&event);
            }
            Ok(())
        })();
        let _ = sender.blocking_send(result);
    }).map_err(|e| e.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("Native key dispatch did not complete")?
}
