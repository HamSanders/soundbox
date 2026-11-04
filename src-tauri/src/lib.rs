//! Konchi desktop shell.
//!
//! Deliberately thin. The Node server already serves the built frontend,
//! the HTTP API and the MCP server on one port, so this process starts that
//! server, waits for it, and points a webview at it. Everything the user sees
//! after the splash is the same app that runs in a browser — which means the
//! desktop build cannot drift from the web build, and there is no second copy
//! of the UI to keep in sync.

mod backend;
mod updater;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

/// How long to wait for the backend before giving up and showing an error.
/// Generous on purpose: a first launch after a model install can be slow.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);

struct AppState {
    backend: Mutex<Option<backend::Backend>>,
}

/// Is the backend answering on its port right now?
///
/// Exposed to the frontend so the desktop app's Activity page can show real
/// status instead of assuming "started once" still means "healthy now" — the
/// server process can die independently of this shell (OOM, a bad model
/// load, `kill` from a terminal) without us finding out any other way.
#[tauri::command]
fn backend_health() -> bool {
    backend::is_healthy(backend::DEFAULT_PORT)
}

/// (Re)start the backend, replacing anything we already own.
///
/// Used for both "it crashed, bring it back" and "it's stuck, restart it" —
/// both look the same from here: stop whatever we own, then start fresh.
/// Adopted servers (`owned` empty) are left alone rather than killed, same as
/// at launch — we didn't start it, so we don't get to stop it either; the
/// user should restart it themselves in that case.
#[tauri::command]
fn restart_backend(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let mut guard = state.backend.lock().unwrap();
        if let Some(mut b) = guard.take() {
            b.shutdown();
        }
    }

    let home = find_server_home(&app).ok_or_else(|| {
        "Could not find the Konchi server. Reinstall the app, or set \
         KONCHI_PROJECT_ROOT to a checkout."
            .to_string()
    })?;
    let port = backend::DEFAULT_PORT;
    let started = backend::start(&home, port)?;
    *state.backend.lock().unwrap() = Some(started);

    if !backend::wait_until_healthy(port, STARTUP_TIMEOUT) {
        return Err("The backend did not come up in time.".to_string());
    }
    Ok(())
}

/// Find the server to run: an explicit checkout, the copy installed with the
/// app, or the checkout this executable was built in — in that order.
///
/// An installer carries the built server, its dependencies and a Node of its
/// own under `$RESOURCE/app` (staged by `scripts/desktop-stage.mjs`), laid out
/// like the repo so the server finds its UI and data the same way in both.
/// A checkout has none of that bundled, which is why `bundled` is reported:
/// it decides which Node runs the server. Failing loudly with a findable
/// reason beats silently launching nothing.
fn find_server_home(app: &tauri::AppHandle) -> Option<backend::ServerHome> {
    fn has_backend(dir: &std::path::Path) -> bool {
        dir.join("server").join("package.json").is_file()
    }

    if let Ok(explicit) = backend::env_var("PROJECT_ROOT") {
        let p = PathBuf::from(explicit);
        if has_backend(&p) {
            return Some(backend::ServerHome { root: p, bundled: false });
        }
    }

    if let Ok(resources) = app.path().resource_dir() {
        let installed = resources.join("app");
        if installed.join("server").join("dist").join("cli.js").is_file() {
            return Some(backend::ServerHome { root: installed, bundled: true });
        }
    }

    find_checkout().map(|root| backend::ServerHome { root, bundled: false })
}

/// The checkout this executable lives in, found by walking up from it (and
/// then from the working directory) to the server package — the
/// `npm run desktop` case.
fn find_checkout() -> Option<PathBuf> {
    fn has_backend(dir: &std::path::Path) -> bool {
        dir.join("server").join("package.json").is_file()
    }

    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }

    for start in starts {
        let mut dir = start.as_path();
        // Walk up a bounded number of levels rather than to the filesystem
        // root, so a stray `server/package.json` far above us can't be
        // mistaken for the project.
        for _ in 0..6 {
            if has_backend(dir) {
                return Some(dir.to_path_buf());
            }
            match dir.parent() {
                Some(parent) => dir = parent,
                None => break,
            }
        }
    }
    None
}

/// Opens the studio's pop-out panels as real windows.
///
/// The studio pops a panel out with `window.open("")` and renders into the
/// blank page it gets back (see `app/src/lib/popout.ts`), so the new window
/// has to stay attached to the page that opened it: same process, same
/// origin, a live `window.opener`. A webview does not do that on its own —
/// left alone, wry refuses `window.open` on macOS and Linux — so each request
/// for a blank window becomes a native window built from the opener's own
/// webview configuration, which is what keeps the two related.
///
/// Anything else (a link with `target="_blank"`) keeps the default
/// behaviour; this exists for the panels, not as a general browser.
/// Must match `POPOUT_CLOSE_TITLE` in app/src/lib/popout.ts.
const POPOUT_CLOSE_TITLE: &str = "konchi:close-popout";

fn popout_handler(
    app: tauri::AppHandle,
) -> impl Fn(Url, NewWindowFeatures) -> NewWindowResponse<tauri::Wry> + Send + 'static {
    static NEXT: AtomicU32 = AtomicU32::new(1);
    move |url, features| {
        if url.as_str() != "about:blank" {
            return NewWindowResponse::Allow;
        }
        let label = format!("panel-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let built = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
            .window_features(features)
            .title("Konchi")
            // The page names itself after the panel ("Timeline · My story"),
            // and the taskbar is where you find which window is which.
            .on_document_title_changed(|window, title| {
                // The studio's way of saying "this panel went back". A script's
                // `window.close()` on a window built here only tears down the
                // webview inside it and leaves an empty native frame, so the
                // page sets this title instead and the window is closed from
                // here, frame and all. See `closePopoutWindow` in
                // app/src/lib/popout.ts.
                if title == POPOUT_CLOSE_TITLE {
                    let _ = window.close();
                    return;
                }
                let _ = window.set_title(&title);
            })
            .build();
        match built {
            Ok(window) => NewWindowResponse::Create { window },
            Err(e) => {
                backend::log_line(&format!("could not open a panel window: {e}"));
                NewWindowResponse::Deny
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            backend: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![backend_health, restart_backend])
        .setup(|app| {
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Konchi")
            .inner_size(1200.0, 820.0)
            .min_inner_size(720.0, 560.0)
            .resizable(true)
            .on_new_window(popout_handler(app.handle().clone()))
            .build()?;

            let handle = app.handle().clone();
            // Startup blocks on network and process spawning, so it cannot run
            // on the main thread — the splash would never paint.
            std::thread::spawn(move || {
                let notify = |stage: &str, message: &str| {
                    if stage == "error" {
                        backend::log_line(&format!("error: {message}"));
                    }
                    let _ = handle.emit("backend-status", serde_json::json!({
                        "stage": stage,
                        "message": message,
                    }));
                };

                let Some(home) = find_server_home(&handle) else {
                    notify(
                        "error",
                        "Could not find the Konchi server. Reinstall the app, or set \
                         KONCHI_PROJECT_ROOT to a checkout.",
                    );
                    return;
                };

                notify("starting", "Starting the Konchi server…");
                let port = backend::DEFAULT_PORT;
                match backend::start(&home, port) {
                    Ok(handle_backend) => {
                        let state = handle.state::<AppState>();
                        *state.backend.lock().unwrap() = Some(handle_backend);
                    }
                    Err(e) => {
                        notify("error", &e);
                        return;
                    }
                }

                notify("waiting", "Loading models and starting up…");
                if !backend::wait_until_healthy(port, STARTUP_TIMEOUT) {
                    notify(
                        "error",
                        "The Konchi server did not start in time. Check the log file in your \
                         data directory (docs/INSTALL.md explains where it lives).",
                    );
                    return;
                }

                notify("ready", "Ready");
                if let Some(win) = handle.get_webview_window("main") {
                    match tauri::Url::parse(&backend::base_url(port)) {
                        Ok(url) => {
                            if let Err(e) = win.navigate(url) {
                                notify("error", &format!("Could not open the app: {e}"));
                            }
                        }
                        Err(e) => notify("error", &format!("Bad server URL: {e}")),
                    }
                }

                // Only an installed copy updates itself: a checkout run with
                // `npm run desktop` is updated with git.
                if home.bundled {
                    updater::check_and_offer(&handle);
                }
            });

            let _ = window;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Konchi");

    app.run(|handle, event| {
        // Stop the server we started. Without this the server process outlives
        // the window and keeps both the port and the GPU held, so the next
        // launch adopts a server the user thinks they closed.
        if let RunEvent::Exit = event {
            let state = handle.state::<AppState>();
            // Take the value out and drop the guard before using it: holding
            // the lock across shutdown() would keep a borrow of `state` alive
            // past the end of this block.
            let taken = state.backend.lock().unwrap().take();
            if let Some(mut b) = taken {
                b.shutdown();
            }
        }
    });
}
