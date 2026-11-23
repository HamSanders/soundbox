//! Updates for the app shell.
//!
//! Checked once per launch, while the splash screen is still showing and
//! before the app window opens, against `latest.json` on the newest published
//! GitHub Release (see `plugins.updater` in tauri.conf.json). The release
//! workflow signs every installer with the updater key, and the plugin refuses
//! anything that doesn't verify against the public key compiled in here.
//!
//! An update installs right there on the splash, with its progress, and Mirli
//! reopens on the new version: no dialog over the app mid-session. On Windows
//! the installer runs silently (`installMode: "quiet"`, which works because the
//! app is installed per user) and relaunches the app itself.
//!
//! This replaces the app only. Models live in the user's data directory,
//! outside the install, and an update never touches them.

use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::{backend, AppState};

/// How long the launch waits to hear whether there is an update. An offline or
/// slow network costs at most this much before the app opens as usual.
const CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// If there is an update, download and install it, reporting on the splash
/// through `notify(stage, message)`. Returns only when there is nothing to
/// install or the update failed; a successful install restarts the app.
///
/// Every failure is logged and swallowed: an offline machine, a GitHub hiccup
/// or a release without `latest.json` must never stop the app from opening.
pub fn update_at_launch(app: &AppHandle, notify: &dyn Fn(&str, &str)) {
    if let Err(e) = tauri::async_runtime::block_on(run(app, notify)) {
        backend::log_line(&format!("update: {e}"));
        notify("waiting", "Opening Mirli…");
    }
}

async fn run(app: &AppHandle, notify: &dyn Fn(&str, &str)) -> Result<(), String> {
    notify("checking", "Checking for updates…");
    let update = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Ok(());
    };

    let version = update.version.clone();
    notify("updating", &format!("Updating to Mirli {version}…"));
    let mut done: u64 = 0;
    let mut last_pct: i64 = -1;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let pct = (done * 100 / total).min(100) as i64;
                    if pct != last_pct {
                        last_pct = pct;
                        notify("updating", &format!("Updating to Mirli {version}… {pct}%"));
                    }
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    notify("updating", &format!("Installing Mirli {version}. It reopens by itself."));
    // Stop the server before installing: on Windows the installer replaces
    // the bundled node.exe, which can't be overwritten while it runs.
    let taken = app.state::<AppState>().backend.lock().unwrap().take();
    if let Some(mut b) = taken {
        b.shutdown();
    }

    // On Windows this hands over to the installer and exits; it relaunches
    // the app when it's done. Elsewhere it returns, and we restart.
    if let Err(e) = update.install(bytes) {
        // The server is already stopped, so open the app fresh on the old
        // version rather than carry on without one.
        backend::log_line(&format!("update: install failed: {e}"));
    }
    app.restart();
}
