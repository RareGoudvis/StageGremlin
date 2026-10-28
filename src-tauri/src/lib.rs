//! StageGremlin desktop shell: wires the audio engine to the React UI.
//!
//! - `engine_thread`: the one thread that owns and drives the audio engine
//! - `commands`: what the UI can call (contract: docs/ipc.md)
//! - `portable`: keep all app data next to the .exe when `portable.txt` is there
//! - `keep_awake`: no sleep or screen-off during a show
//! - `background`: background music window, its Windows volume, auto-duck
//! - `settings`: per-machine settings file (preferred audio outputs)
//! - `outputs`: device-name helper shared by show engine and preview
//! - `preview`: headphone preview, a second engine on its own output
//! - `resume`: crash resume file while in Run
//! - `yt`: YouTube import (yt-dlp, ffmpeg) and media conversion
//! - `files`: show export zip, file checks, show in Explorer
//! - `media_watch`: watches the show's media/ folder for changed files
//! - `audac`: remote for the school's AUDAC MTX88 zone matrix (network, not audio)
//! - `updates`: "is there a newer build on GitHub?"
//! - `extensions`: uBlock Origin Lite for the background player window
//! - `streambox`: find cast targets (Google Cast, AirPlay, Spotify Connect, DLNA) on the network

mod audac;
mod background;
mod commands;
mod engine_thread;
mod extensions;
mod files;
mod keep_awake;
mod media_watch;
mod outputs;
mod portable;
mod preview;
mod resume;
mod settings;
mod streambox;
mod updates;
mod yt;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use commands::{AnalysisCache, AppInfo};
use engine_thread::EngineHandle;
use preview::PreviewHandle;
use resume::ResumeState;

pub fn run() {
    // Portable mode has to be decided before the window exists, because WebView2
    // picks its data folder when it starts.
    let portable_dir = portable::portable_data_dir();
    if let Some(dir) = &portable_dir {
        let _ = std::fs::create_dir_all(dir);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(background::plugin())
        .manage(AnalysisCache::default())
        .setup(move |app| {
            let data_dir = match &portable_dir {
                Some(dir) => dir.clone(),
                None => app.path().app_data_dir()?,
            };
            let _ = std::fs::create_dir_all(&data_dir);
            // A new build unzipped into a fresh folder: bring the last-used settings over.
            let carried_from = {
                let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf()));
                let installed = if portable_dir.is_some() { app.path().app_data_dir().ok() } else { None };
                let from_portable = if portable_dir.is_some() { exe_dir.as_deref() } else { None };
                settings::carry_over(&data_dir, &settings::other_copies(from_portable, installed.as_deref()))
            };
            if let Some(from) = &carried_from {
                eprintln!("[settings] brought over from {}", from.display());
            }

            // The main window is made here (tauri.conf.json has "create": false) so it can get its
            // browser data folder directly: portable keeps it next to the .exe. (An environment
            // variable would force EVERY window into that folder, and the background players need
            // folders of their own: see background/window.rs.)
            let main_webview_dir = portable_dir.as_ref().map(|d| d.join("webview"));
            let main_config = app.config().app.windows.first().cloned().ok_or("no window in tauri.conf.json")?;
            let mut main = tauri::WebviewWindowBuilder::from_config(app.handle(), &main_config)?
                .additional_browser_args(background::window::BROWSER_ARGS);
            if let Some(dir) = &main_webview_dir {
                main = main.data_directory(dir.clone());
            }
            main.build()?;
            app.manage(background::WebviewDirs { main: main_webview_dir, players: data_dir.join("players") });

            app.manage(AppInfo {
                version: app.package_info().version.to_string(),
                portable: portable_dir.is_some(),
                data_dir: data_dir.display().to_string(),
                build: updates::current_tag().map(String::from),
                carried_from: carried_from.map(|p| p.display().to_string()),
            });
            let machine = settings::load(&settings::path_in(&data_dir));
            let engine = EngineHandle::spawn(app.handle().clone(), machine.output_device);
            // Preview gets the show output's name, to warn when both are the same device.
            app.manage(PreviewHandle::spawn(app.handle().clone(), machine.preview_device, engine.output_slot()));
            let resume = Arc::new(ResumeState::new(&data_dir));
            resume.clone().spawn_writer(engine.snapshot_slot());
            app.manage(resume);
            app.manage(yt::Yt::new(app.handle().clone(), &data_dir));
            app.manage(engine);
            app.manage(media_watch::MediaWatch::new(app.handle().clone()));
            app.manage(extensions::Extensions::prepare(app.handle(), &data_dir));
            app.manage(streambox::Sending::default());
            app.manage(background::start(app.handle().clone(), data_dir.clone()));
            app.manage(audac::start(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_export,
            commands::settings_import,
            commands::engine_set_show,
            commands::engine_go,
            commands::engine_stop_all,
            commands::engine_panic,
            commands::engine_stop_cue,
            commands::engine_toggle_under,
            commands::engine_release_vamp,
            commands::engine_pause_all,
            commands::engine_set_master,
            commands::engine_set_playhead,
            commands::audio_list_outputs,
            commands::audio_set_output,
            commands::audio_output_status,
            commands::audio_default_output,
            commands::open_sound_settings,
            commands::show_open,
            commands::show_save,
            commands::analyze_file,
            commands::app_info,
            commands::engine_pad,
            commands::engine_go_from,
            commands::engine_tone,
            commands::audio_set_preview_output,
            commands::preview_play,
            commands::preview_stop,
            commands::app_session,
            commands::app_resume_info,
            commands::app_resume_dismiss,
            commands::engine_resume,
            commands::yt_status,
            commands::yt_install,
            commands::yt_resolve,
            commands::yt_download,
            commands::media_convert,
            commands::show_export_zip,
            commands::media_watch,
            commands::file_exists,
            commands::show_in_folder,
            commands::settings_get,
            commands::settings_set,
            background::bg_open,
            background::bg_hide,
            background::bg_command,
            background::bg_spotify_connect,
            background::bg_start_list,
            background::bg_shuffle_repeat,
            background::bg_set_level,
            background::bg_set_config,
            background::bg_get_state,
            background::bg_get_config,
            background::bg_play_track,
            background::bg_dock,
            background::bg_close,
            background::bg_set_deck,
            background::bg_crossfade,
            background::bg_set_fader,
            background::bg_set_low_spec,
            audac::audac_connect,
            audac::audac_disconnect,
            audac::audac_get_state,
            audac::audac_set_volume,
            audac::audac_step_volume,
            audac::audac_set_input,
            audac::audac_set_mute,
            audac::audac_set_guard,
            audac::audac_talk,
            updates::app_check_update,
            updates::open_release_page,
            streambox::net_discover,
            streambox::net_probe,
            streambox::streambox_status,
            streambox::streambox_set_volume,
            streambox::streambox_set_mute,
            streambox::streambox_transport,
            streambox::streambox_send_start,
            streambox::streambox_send_stop,
            streambox::streambox_sending,
        ])
        .build(tauri::generate_context!())
        .expect("error while starting StageGremlin")
        .run(|app, event| {
            // A clean exit removes the crash-resume file: no "resume?" next start.
            if let RunEvent::Exit = event {
                if let Some(resume) = app.try_state::<Arc<ResumeState>>() {
                    resume.clean_exit();
                }
            }
        });
}
