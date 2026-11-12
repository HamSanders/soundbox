//! Updates for the app shell.
//!
//! Checked once per launch, after the server is up, against `latest.json` on
//! the newest published GitHub Release (see `plugins.updater` in
//! tauri.conf.json). The release workflow signs every installer with the
//! updater key, and the plugin refuses anything that doesn't verify against
//! the public key compiled in here.
//!
//! This replaces the app only. Models live in the user's data directory,
//! outside the install, and an update never touches them.

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

use crate::{backend, AppState};

/// Ask once, install if the user agrees, then restart into the new version.
///
/// Every failure is logged and swallowed: an offline machine, a GitHub hiccup
/// or a release without `latest.json` must never stop the app from working.
pub fn check_and_offer(app: &AppHandle) {
    if let Err(e) = tauri::async_runtime::block_on(run(app)) {
        backend::log_line(&format!("update check: {e}"));
    }
}

async fn run(app: &AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Ok(());
    };

    let install = app
        .dialog()
        .message(format!(
            "Konchi {} is available. You have {}.\n\n\
             Install it now? Konchi will close, update and restart. \
             Your models and projects are kept.",
            update.version, update.current_version
        ))
        .title("Update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and restart".into(),
            "Later".into(),
        ))
        .blocking_show();
    if !install {
        return Ok(());
    }

    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    // Stop the server before installing: on Windows the installer replaces
    // the bundled node.exe, which can't be overwritten while it runs.
    let taken = app.state::<AppState>().backend.lock().unwrap().take();
    if let Some(mut b) = taken {
        b.shutdown();
    }

    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}
