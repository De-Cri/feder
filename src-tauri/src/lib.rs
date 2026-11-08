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
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(w) = app.get_webview_window("main") {
                linux_media::enable(&w);
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("errore avviando Cerchio");
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
