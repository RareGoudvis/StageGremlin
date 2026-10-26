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
    let mut s = Show::default();
    s.sections = vec![Section { cues, ..Section::new("Act 1") }];
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
    show::save(&path, &mut s).unwrap();
    assert_eq!(s.sections[0].cues[0].file, "media/song.wav");
    assert!(dst.path().join("media/song.wav").exists());
    let back = show::load(&path).unwrap();
    assert_eq!(back, s);
    // Saving again keeps one copy and makes a backup.
    show::save(&path, &mut s).unwrap();
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
