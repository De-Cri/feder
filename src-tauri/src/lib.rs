use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Una sola istanza: riaprire l'app porta in primo piano la finestra esistente.
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

/// Finestra nascosta e nessuna chiamata in corso: chiede a WebView2 di usare
/// meno memoria (libera cache e memoria non indispensabile). Al ritorno torna normale.
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
            // ICoreWebView2_19 esiste da WebView2 Runtime 1.0.2210: se è più vecchio, niente.
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

/// WebKitGTK di default ha getUserMedia/WebRTC disattivati e nega i permessi
/// di microfono/camera. Qui li abilitiamo e concediamo i permessi media.
/// Se la build di WebKitGTK della distro non include WebRTC, la UI lo rileva
/// e mostra un avviso (la chat funziona comunque).
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
