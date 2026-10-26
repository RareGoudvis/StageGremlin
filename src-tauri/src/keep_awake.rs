//! Stops Windows from sleeping or blanking the screen in the middle of a show.

/// Tells Windows "this program needs the system and the display".
/// The request holds until the calling thread ends, so call it from a thread that
/// lives as long as the app (we use the engine thread).
#[cfg(windows)]
pub fn keep_awake() {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    // SAFETY: a plain Win32 call with flag values only; no pointers involved.
    unsafe {
        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
    }
}

#[cfg(not(windows))]
pub fn keep_awake() {}
