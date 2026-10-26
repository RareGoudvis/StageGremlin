//! Windows part of `session_volume.rs`: Core Audio session lookup and volume.
//!
//! The chain, in plain words:
//!   device enumerator → every active playback device → its session manager →
//!   list of sessions → for each: which process owns it? → if it is one of our
//!   WebView2 helpers, keep its volume control.
//!
//! Every call into Windows here can fail (device unplugged, session gone). We never panic:
//! a failed session is skipped and found again on the next refresh.

use std::collections::HashMap;

use windows::core::Interface;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;

pub struct Sessions {
    com_ok: bool,
    enumerator: Option<IMMDeviceEnumerator>,
    /// Volume controls of the sessions we found on the last refresh.
    volumes: Vec<ISimpleAudioVolume>,
    own_pid: u32,
}

impl Sessions {
    pub fn new() -> Self {
        // COM must be started on every thread that uses it. Multithreaded mode: we don't
        // run a message loop on this thread.
        let com_ok = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        let enumerator = if com_ok {
            unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()
        } else {
            None
        };
        Self { com_ok, enumerator, volumes: Vec::new(), own_pid: unsafe { GetCurrentProcessId() } }
    }

    pub fn refresh(&mut self, gain: f32) -> usize {
        self.volumes = self.find().unwrap_or_default();
        self.set(gain);
        self.volumes.len()
    }

    pub fn set(&mut self, gain: f32) {
        let gain = gain.clamp(0.0, 1.0);
        for v in &self.volumes {
            // The second argument is an "event context" GUID used to tell our own changes apart
            // in change notifications; we don't listen to those, so null is fine.
            let _ = unsafe { v.SetMasterVolume(gain, std::ptr::null()) };
        }
    }

    fn find(&self) -> windows::core::Result<Vec<ISimpleAudioVolume>> {
        let Some(enumerator) = &self.enumerator else { return Ok(Vec::new()) };
        let parents = process_parents();
        let mut found = Vec::new();

        // Every active playback device, not only the default one: the background must follow
        // the show to the Qu-24 even when Windows' default device is the laptop speaker.
        let devices = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)? };
        let device_count = unsafe { devices.GetCount()? };
        for d in 0..device_count {
            let Ok(device) = (unsafe { devices.Item(d) }) else { continue };
            let Ok(manager) = (unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) }) else { continue };
            let Ok(list) = (unsafe { manager.GetSessionEnumerator() }) else { continue };
            let session_count = unsafe { list.GetCount() }.unwrap_or(0);
            for s in 0..session_count {
                let Ok(control) = (unsafe { list.GetSession(s) }) else { continue };
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                let Ok(pid) = (unsafe { control2.GetProcessId() }) else { continue };
                // pid 0 is the "System sounds" session; our own pid is the show audio (kira).
                if pid == 0 || pid == self.own_pid {
                    continue;
                }
                if !is_descendant(pid, self.own_pid, &parents) {
                    continue;
                }
                if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                    found.push(volume);
                }
            }
        }
        Ok(found)
    }
}

impl Drop for Sessions {
    fn drop(&mut self) {
        // COM objects must be released before COM is shut down on this thread.
        self.volumes.clear();
        self.enumerator = None;
        if self.com_ok {
            unsafe { CoUninitialize() };
        }
    }
}

/// A map "process id → parent process id" of every running process, taken right now.
fn process_parents() -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else { return map };
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            map.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    map
}

/// True when `pid` was started (directly or through helpers) by `ancestor`.
/// Walks up the parent chain; the step limit guards against loops from reused process ids.
fn is_descendant(pid: u32, ancestor: u32, parents: &HashMap<u32, u32>) -> bool {
    let mut current = pid;
    for _ in 0..32 {
        match parents.get(&current) {
            Some(&parent) if parent == ancestor => return true,
            Some(&parent) if parent != 0 && parent != current => current = parent,
            _ => return false,
        }
    }
    false
}
