use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

/// Passed by the "start with the PC" entry: Feder starts without showing the window.
const HIDDEN_ARG: &str = "--hidden";
const TRAY_ID: &str = "feder";

/// Closing the window leaves Feder running in the tray (setting, off by default).
struct KeepRunning(AtomicBool);

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance: reopening the app brings the existing window to the front
        // (also when it's hidden in the tray).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .manage(KeepRunning(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![set_background_mode, set_keep_running])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.state::<KeepRunning>().0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(w) = app.get_webview_window("main") {
                linux_media::enable(&w);
            }
            // The window starts hidden (tauri.conf.json): shown right away, unless Feder
            // started with the PC. Then the page decides (set_keep_running).
            if !std::env::args().any(|a| a == HIDDEN_ARG) {
                show_main(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("errore avviando Feder");
}

/// The page passes the "keep running in the background" choice at startup and when it changes.
/// On: tray icon (click = open, menu = open/quit) and closing only hides the window.
/// Off: no tray icon, and if the window is hidden (started with the PC) it's shown.
#[tauri::command]
fn set_keep_running(
    app: AppHandle,
    state: State<KeepRunning>,
    on: bool,
    open: String,
    quit: String,
) -> Result<(), String> {
    state.0.store(on, Ordering::Relaxed);
    if !on {
        let _ = app.remove_tray_by_id(TRAY_ID);
        let visible = app
            .get_webview_window("main")
            .map(|w| w.is_visible().unwrap_or(true))
            .unwrap_or(true);
        if !visible {
            show_main(&app);
        }
        return Ok(());
    }
    let err = |e: tauri::Error| e.to_string();
    let open_item = MenuItem::with_id(&app, "open", open, true, None::<&str>).map_err(err)?;
    let quit_item = MenuItem::with_id(&app, "quit", quit, true, None::<&str>).map_err(err)?;
    let menu = Menu::with_items(&app, &[&open_item, &quit_item]).map_err(err)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(err)?;
        return Ok(());
    }
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Feder")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(&app).map_err(err)?;
    Ok(())
}

/// Hidden window and no call in progress: asks WebView2 to use less memory
/// (frees caches and non-essential memory). Back to normal when you return.
#[tauri::command]
fn set_background_mode(window: tauri::WebviewWindow, background: bool) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(move |wv| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            use windows_core::Interface;
            let level = if background {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            };
            // ICoreWebView2_19 exists since WebView2 Runtime 1.0.2210: if older, do nothing.
            if let Ok(core) = wv.controller().CoreWebView2() {
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let _ = core19.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (window, background);
    }
}

/// WebKitGTK disables getUserMedia/WebRTC by default and denies microphone/camera
/// permissions. Here we enable them and grant media permissions.
/// If the distro's WebKitGTK build lacks WebRTC, the UI detects it
/// and shows a warning (chat still works).
#[cfg(target_os = "linux")]
mod linux_media {
    use webkit2gtk::glib::object::Cast;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt,
    };

    pub fn enable(window: &tauri::WebviewWindow) {
        let _ = window.with_webview(|wv| {
            let view = wv.inner();
            if let Some(settings) = WebViewExt::settings(&view) {
                settings.set_enable_media_stream(true);
                settings.set_enable_webrtc(true);
                settings.set_enable_mediasource(true);
                settings.set_media_playback_requires_user_gesture(false);
            }
            view.connect_permission_request(|_, request| {
                if request.downcast_ref::<UserMediaPermissionRequest>().is_some() {
                    request.allow();
                    return true;
                }
                false
            });
        });
    }
}
