use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance: reopening the app brings the existing window to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_background_mode])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(w) = app.get_webview_window("main") {
                linux_media::enable(&w);
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("errore avviando Feder");
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
