use std::path::{Path, PathBuf};

use cueplay_engine::kira::backend::mock::{MockBackend, MockBackendSettings};
use cueplay_engine::kira::AudioManagerSettings;
use cueplay_engine::show::{self, Attach, Cue, Follow, Section, Show};
use cueplay_engine::{analysis, Engine, GoResult};

const RATE: u32 = 48_000;

fn write_sine(path: &Path, secs: f32, amp: f32, rate: u32) {
    let spec = hound::WavSpec { channels: 2, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec).unwrap();
    for i in 0..(secs * rate as f32) as u32 {
        let s = (amp * (i as f32 * 2.0 * std::f32::consts::PI * 440.0 / rate as f32).sin() * i16::MAX as f32) as i16;
        w.write_sample(s).unwrap();
        w.write_sample(s).unwrap();
    }
    w.finalize().unwrap();
}

fn engine() -> Engine<MockBackend> {
    let settings = AudioManagerSettings {
        backend_settings: MockBackendSettings { sample_rate: RATE },
        // One mock `process()` call renders exactly one 10 ms tick of audio.
        internal_buffer_size: (RATE / 100) as usize,
        ..Default::default()
    };
    Engine::new(settings, -1.0).unwrap()
}

/// Runs the mock audio thread for `secs` of audio, ticking the engine as the host would.
fn run(e: &mut Engine<MockBackend>, secs: f64) {
    let steps = (secs * 100.0) as usize; // 10 ms ticks
    for _ in 0..steps {
        e.backend_mut().on_start_processing();
        e.backend_mut().process();
        // Streaming sounds decode on a background thread; give it a moment.
        std::thread::sleep(std::time::Duration::from_micros(300));
        e.tick(0.01);
    }
}

fn show_with(dir: &Path, cues: Vec<Cue>) -> (Show, PathBuf) {
    let mut s = Show { sections: vec![Section { cues, ..Section::new("Act 1") }], ..Default::default() };
    s.settings.double_go_ms = 0;
    s.renumber();
    (s, dir.to_path_buf())
}

fn cue(dir: &Path, name: &str, secs: f32) -> Cue {
    let p = dir.join(format!("{name}.wav"));
    write_sine(&p, secs, 0.3, RATE);
    Cue::from_file(&p)
}

#[test]
fn go_walks_the_playhead_and_skips_attached_cues() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 1.0);
    let mut child = cue(dir.path(), "child", 0.5);
    child.attach = Some(Attach { to: a.id.clone(), at: 0.2 });
    let b = cue(dir.path(), "b", 1.0);
    let (s, base) = show_with(dir.path(), vec![a.clone(), child.clone(), b.clone()]);
    assert_eq!(s.cue(&child.id).unwrap().number, "1.1");
    let mut e = engine();
    e.set_show(s, Some(base));
    assert_eq!(e.playhead(), Some(a.id.as_str()));
    assert_eq!(e.go(), GoResult::Fired);
    assert_eq!(e.playhead(), Some(b.id.as_str()), "attached cue is not in the GO queue");
    run(&mut e, 0.35);
    let st = e.state();
    assert!(st.running.iter().any(|r| r.cue_id == child.id && r.attached), "attached cue fired inside its parent");
}

#[test]
fn stopping_a_parent_stops_its_attached_cues() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 3.0);
    let mut child = cue(dir.path(), "child", 3.0);
    child.attach = Some(Attach { to: a.id.clone(), at: 0.1 });
    child.stop_fade = 0.0;
    let mut a2 = a.clone();
    a2.stop_fade = 0.0;
    let (s, base) = show_with(dir.path(), vec![a2, child]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    run(&mut e, 0.3);
    assert_eq!(e.state().running.len(), 2);
    e.stop_cue(&a.id);
    run(&mut e, 0.2);
    assert!(e.state().running.is_empty());
}

#[test]
fn follow_after_end_starts_the_next_cue() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = cue(dir.path(), "a", 0.3);
    a.follow = Follow::AfterEnd;
    let b = cue(dir.path(), "b", 2.0);
    let (s, base) = show_with(dir.path(), vec![a, b.clone()]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    run(&mut e, 0.6);
    let st = e.state();
    assert_eq!(st.running.len(), 1);
    assert_eq!(st.running[0].cue_id, b.id);
}

#[test]
fn follow_after_start_overlaps_and_plays_three_passes() {
    // Brief example: cue 1 starts cue 1.5 after 10 s, and 1.5 plays 3 times then stops.
    let dir = tempfile::tempdir().unwrap();
    let mut a = cue(dir.path(), "a", 6.0);
    a.follow = Follow::AfterStart { delay: 0.5 };
    let mut b = cue(dir.path(), "b", 1.0);
    b.play_count = 3;
    let (s, base) = show_with(dir.path(), vec![a.clone(), b.clone()]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    run(&mut e, 0.7);
    assert_eq!(e.state().running.len(), 2, "both play at once");
    run(&mut e, 1.0);
    assert!(e.state().running.iter().any(|r| r.cue_id == b.id && r.pass == 2));
    run(&mut e, 2.2); // b: 0.5 + 3 × 1.0 = ends at 3.5 s
    assert!(!e.state().running.iter().any(|r| r.cue_id == b.id), "b stopped after 3 passes");
    assert!(e.state().running.iter().any(|r| r.cue_id == a.id));
}

#[test]
fn panic_cancels_pre_waits_and_stops_everything() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 3.0);
    let mut b = cue(dir.path(), "b", 3.0);
    b.pre_wait = 1.0;
    let (s, base) = show_with(dir.path(), vec![a, b]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    e.go();
    run(&mut e, 0.1);
    assert_eq!(e.state().pending.len(), 1);
    e.panic();
    run(&mut e, 1.2);
    let st = e.state();
    assert!(st.running.is_empty() && st.pending.is_empty());
}

#[test]
fn double_go_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 1.0);
    let b = cue(dir.path(), "b", 1.0);
    let (mut s, base) = show_with(dir.path(), vec![a, b]);
    s.settings.double_go_ms = 300;
    let mut e = engine();
    e.set_show(s, Some(base));
    assert_eq!(e.go(), GoResult::Fired);
    run(&mut e, 0.1);
    assert_eq!(e.go(), GoResult::Ignored);
    run(&mut e, 0.3);
    assert_eq!(e.go(), GoResult::Fired);
}

#[test]
fn missing_file_is_skipped_and_logged() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Cue::from_file(&dir.path().join("nope.wav"));
    a.name = "Missing".into();
    let (s, base) = show_with(dir.path(), vec![a]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    run(&mut e, 0.1); // the file is opened on the loader thread; the skip lands a tick later
    let st = e.state();
    assert!(st.running.is_empty());
    assert!(st.new_log.iter().any(|l| l.kind == "skip"));
}

#[test]
fn analysis_measures_loudness_and_norm_gain_respects_peak_cap() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("tone.wav");
    write_sine(&p, 5.0, 0.5, 48_000);
    let a = analysis::analyze(&p).unwrap();
    // A 440 Hz sine at 0.5 (−6 dBFS) in stereo measures about −6 LUFS (K-weighting adds ~0 dB at 440 Hz, stereo +3).
    assert!((a.loudness.lufs - -6.0).abs() < 1.5, "lufs {}", a.loudness.lufs);
    assert!((a.loudness.true_peak_db - -6.0).abs() < 0.5, "tp {}", a.loudness.true_peak_db);
    assert!((a.loudness.duration - 5.0).abs() < 0.01);
    assert_eq!(a.waveform.len(), analysis::WAVEFORM_POINTS);

    let settings = show::ShowSettings::default();
    let g = show::norm_gain(&a.loudness, &settings);
    assert!(g.gain_db < 0.0 && !g.peak_limited, "loud tone is turned down");

    // Quiet track with one loud hit: the cap wins.
    let quiet = show::Loudness { lufs: -30.0, true_peak_db: -3.0, lra: 5.0, duration: 60.0 };
    let g = show::norm_gain(&quiet, &settings);
    assert!(g.peak_limited);
    assert!((g.gain_db - 2.0).abs() < 1e-9);
}

#[test]
fn save_copies_media_and_reopens() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    let a = cue(src.path(), "song", 0.2);
    let (mut s, _) = show_with(src.path(), vec![a]);
    let path = dst.path().join("Schoolfeest.sg");
    show::save(&path, &mut s, None).unwrap();
    assert_eq!(s.sections[0].cues[0].file, "media/song.wav");
    assert!(dst.path().join("media/song.wav").exists());
    let back = show::load(&path).unwrap();
    assert_eq!(back, s);
    // Saving again keeps one copy and makes a backup.
    show::save(&path, &mut s, None).unwrap();
    assert_eq!(std::fs::read_dir(dst.path().join("media")).unwrap().count(), 1);
    assert_eq!(std::fs::read_dir(dst.path().join("backups")).unwrap().count(), 1);
}

#[test]
fn vamp_repeats_until_released() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = cue(dir.path(), "a", 4.0);
    a.vamp = Some(cueplay_engine::show::Vamp { a: 1.0, b: 2.0, on: true });
    let (s, base) = show_with(dir.path(), vec![a.clone()]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    run(&mut e, 3.5);
    let st = e.state();
    assert!(st.running[0].vamping && st.running[0].position < 2.0, "still inside the vamp");
    e.release_vamp(None);
    run(&mut e, 3.5);
    assert!(e.state().running.is_empty(), "played on to the end after Release");
}

#[test]
fn under_toggles_and_reports() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 3.0);
    let (s, base) = show_with(dir.path(), vec![a]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    run(&mut e, 0.1);
    e.toggle_under(None);
    assert!(e.state().running[0].under);
    e.toggle_under(None);
    assert!(!e.state().running[0].under);
}

#[test]
fn pads_toggle_and_never_move_the_playhead() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 3.0);
    let (mut s, base) = show_with(dir.path(), vec![a.clone()]);
    let mut pc = cue(dir.path(), "applause", 3.0);
    pc.stop_fade = 0.0;
    s.pads.push(show::Pad { hotkey: "1".into(), mode: show::PadMode::Toggle, cue: pc, ..Default::default() });
    let pad_id = s.pads[0].id.clone();
    let mut e = engine();
    e.set_show(s, Some(base));
    e.play_pad(&pad_id);
    run(&mut e, 0.2);
    let st = e.state();
    assert_eq!(st.running.len(), 1);
    assert_eq!(st.running[0].pad_id.as_deref(), Some(pad_id.as_str()));
    assert_eq!(st.playhead.as_deref(), Some(a.id.as_str()));
    e.play_pad(&pad_id);
    run(&mut e, 0.2);
    assert!(e.state().running.is_empty());
}

#[test]
fn rehearsal_starts_inside_a_cue() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 4.0);
    let (s, base) = show_with(dir.path(), vec![a.clone()]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go_from(&a.id, 2.5);
    run(&mut e, 0.2);
    let st = e.state();
    assert!(st.running[0].position > 2.5, "pos {}", st.running[0].position);
    assert!(st.running[0].remaining < 1.5);
}

#[test]
fn sine_frequency_loops_without_a_click() {
    use cueplay_engine::tone::loop_safe_hz;
    assert_eq!(loop_safe_hz(1000.0), 1000.0);
    assert_eq!(loop_safe_hz(63.04), 63.0);
    assert_eq!(loop_safe_hz(5.0), 20.0, "below hearing: clamped");
    assert_eq!(loop_safe_hz(30_000.0), 20_000.0);
}

#[test]
fn tone_plays_and_stop_all_stops_it() {
    let mut e = engine();
    e.start_tone(cueplay_engine::tone::ToneKind::Pink, -14.0, 1000.0);
    run(&mut e, 0.1);
    assert!(e.tone_playing());
    e.stop_all();
    run(&mut e, 0.5);
    assert!(!e.tone_playing());
}

#[test]
fn pause_all_holds_cues_and_timers() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 4.0);
    let mut b = cue(dir.path(), "b", 4.0);
    b.pre_wait = 0.5;
    let (s, base) = show_with(dir.path(), vec![a, b.clone()]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go();
    e.go(); // b waits 0.5 s
    run(&mut e, 0.2);
    assert!(e.toggle_pause_all());
    run(&mut e, 0.5);
    let st = e.state();
    let pos = st.running[0].position;
    assert!(st.paused && st.pending.len() == 1, "pre-wait held while paused");
    run(&mut e, 0.5);
    assert!((e.state().running[0].position - pos).abs() < 0.02, "position held");
    assert!(!e.toggle_pause_all());
    run(&mut e, 1.0);
    assert!(e.state().running.iter().any(|r| r.cue_id == b.id), "pre-wait finished after resume");
}

// ---- Regression: Save As to another folder (review #1) and content-based dedupe (#2) ----

fn write_bytes(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn save_as_to_another_folder_copies_media_and_works_without_the_original() {
    let src = tempfile::tempdir().unwrap();
    let a = cue(src.path(), "song", 0.2);
    let (mut s, _) = show_with(src.path(), vec![a]);
    let first = src.path().join("show").join("Schoolfeest.sg");
    std::fs::create_dir_all(first.parent().unwrap()).unwrap();
    show::save(&first, &mut s, None).unwrap();
    assert_eq!(s.sections[0].cues[0].file, "media/song.wav");

    // Save as into a different folder: relative paths must be read from the OLD folder.
    let other = tempfile::tempdir().unwrap();
    let second = other.path().join("Kopie.sg");
    show::save(&second, &mut s, first.parent()).unwrap();
    assert_eq!(s.sections[0].cues[0].file, "media/song.wav");
    let copied = other.path().join("media/song.wav");
    assert!(copied.exists(), "media copied into the new folder");

    // The new folder works on its own.
    drop(src);
    let back = show::load(&second).unwrap();
    let resolved = back.resolve(Some(other.path()), &back.sections[0].cues[0].file);
    assert!(resolved.exists());
}

#[test]
fn different_recordings_with_the_same_name_and_size_are_not_merged() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    // Already in the destination's media folder: same name, same size, different content.
    write_bytes(&dst.path().join("media/take.wav"), &[1u8; 64]);
    write_bytes(&src.path().join("take.wav"), &[2u8; 64]);
    let mut c = Cue::from_file(&src.path().join("take.wav"));
    c.name = "Take".into();
    let (mut s, _) = show_with(src.path(), vec![c]);
    show::save(&dst.path().join("Show.sg"), &mut s, None).unwrap();
    let f = &s.sections[0].cues[0].file;
    assert_ne!(f, "media/take.wav", "must not reuse a different recording");
    assert_eq!(std::fs::read(dst.path().join(f)).unwrap(), vec![2u8; 64]);
}

#[test]
fn identical_files_are_reused_not_duplicated() {
    let src = tempfile::tempdir().unwrap();
    let dst = tempfile::tempdir().unwrap();
    write_bytes(&dst.path().join("media/take.wav"), &[7u8; 64]);
    write_bytes(&src.path().join("take.wav"), &[7u8; 64]);
    let (mut s, _) = show_with(src.path(), vec![Cue::from_file(&src.path().join("take.wav"))]);
    show::save(&dst.path().join("Show.sg"), &mut s, None).unwrap();
    assert_eq!(s.sections[0].cues[0].file, "media/take.wav");
    assert_eq!(std::fs::read_dir(dst.path().join("media")).unwrap().count(), 1);
}

// ---- Regression: no file I/O on the engine thread (review #3) ----

#[test]
fn go_never_opens_files_on_the_engine_thread() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 2.0);
    let (s, base) = show_with(dir.path(), vec![a.clone()]);
    let mut e = engine();
    e.set_show(s, Some(base));
    // No tick yet, so nothing was pre-opened: GO must hand the file to the loader and
    // return at once instead of opening it here.
    let t = std::time::Instant::now();
    e.go();
    assert!(t.elapsed() < std::time::Duration::from_millis(5), "GO returned without touching the disk");
    assert!(e.is_loading());
    assert!(e.state().running.is_empty());
    run(&mut e, 0.2);
    assert!(!e.is_loading());
    assert_eq!(e.state().running.len(), 1, "started as soon as the loader had the file");
}

#[test]
fn upcoming_cues_are_preopened_so_go_starts_in_the_same_tick() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 2.0);
    let (s, base) = show_with(dir.path(), vec![a]);
    let mut e = engine();
    e.set_show(s, Some(base));
    run(&mut e, 0.2); // ticks let the loader pre-open the standing-by cue
    e.go();
    assert!(!e.is_loading());
    assert_eq!(e.state().running.len(), 1);
}

#[test]
fn stop_all_cancels_sounds_still_waiting_for_their_file() {
    let dir = tempfile::tempdir().unwrap();
    let a = cue(dir.path(), "a", 2.0);
    let (s, base) = show_with(dir.path(), vec![a]);
    let mut e = engine();
    e.set_show(s, Some(base));
    e.go(); // not pre-opened: waits for the loader
    e.panic();
    run(&mut e, 0.3);
    assert!(e.state().running.is_empty(), "nothing starts after Panic");
}

// ---- Regression: rehearsal start keeps attached cues and follow triggers (review #6) ----

#[test]
fn rehearsal_start_schedules_attached_cues_and_follows_from_the_start_point() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = cue(dir.path(), "a", 8.0);
    a.follow = Follow::AfterStart { delay: 4.0 };
    let mut early = cue(dir.path(), "early", 3.0);
    early.attach = Some(Attach { to: a.id.clone(), at: 1.0 }); // already passed when starting at 2.0
    let mut late = cue(dir.path(), "late", 3.0);
    late.attach = Some(Attach { to: a.id.clone(), at: 3.0 }); // due 1.0 s after a start at 2.0
    let b = cue(dir.path(), "b", 3.0);
    let (s, base) = show_with(dir.path(), vec![a.clone(), early.clone(), late.clone(), b.clone()]);
    let mut e = engine();
    e.set_show(s, Some(base));
    run(&mut e, 0.2);
    e.go_from(&a.id, 2.0);
    run(&mut e, 0.6);
    let st = e.state();
    assert!(st.running.iter().any(|r| r.cue_id == a.id));
    assert!(!st.running.iter().any(|r| r.cue_id == late.id), "not yet: due 1.0 s after the start");
    run(&mut e, 0.7);
    let st = e.state();
    assert!(st.running.iter().any(|r| r.cue_id == late.id), "attached cue fired relative to the start point");
    assert!(!st.running.iter().any(|r| r.cue_id == early.id), "attached cue before the start point is skipped");
    assert!(!st.running.iter().any(|r| r.cue_id == b.id), "follow not yet: 4 s after cue start = 2 s after a start at 2.0");
    run(&mut e, 1.0);
    assert!(e.state().running.iter().any(|r| r.cue_id == b.id), "follow trigger fired, shortened by the start offset");
}
