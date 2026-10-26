//! Volume of the background player, set through the Windows mixer.
//!
//! The web player (Spotify, YouTube Music, …) plays inside WebView2, whose sound comes out of
//! `msedgewebview2.exe` helper processes that our app started. Windows gives every process
//! that plays sound an "audio session" with its own volume: the slider you see per app in the
//! Windows Volume Mixer. We find the sessions that belong to our WebView2 helpers and set that
//! slider. This works for any site and never depends on the page's own code.
//!
//! Why "descendant of our process": WebView2 helpers are children (or grandchildren) of our
//! app. Our *own* process is skipped on purpose: the show audio (kira) plays from it, and the
//! show must never be ducked.
//!
//! Only Windows has this; on other platforms `SessionVolume` does nothing so the app still builds.

/// Finds the background player's audio sessions and sets their volume.
/// Lives on one thread (COM objects may not move between threads).
pub struct SessionVolume {
    #[cfg(windows)]
    inner: win::Sessions,
}

impl SessionVolume {
    /// Must be called on the thread that will use it (it starts COM there on Windows).
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            inner: win::Sessions::new(),
        }
    }

    /// Looks for sessions again (new ones appear when the page starts playing) and gives every
    /// session found the volume `gain`. Returns how many sessions were found.
    pub fn refresh(&mut self, gain: f32) -> usize {
        #[cfg(windows)]
        {
            self.inner.refresh(gain)
        }
        #[cfg(not(windows))]
        {
            let _ = gain;
            0
        }
    }

    /// Sets every known session to `gain` (0.0 = silent, 1.0 = unity, the Windows maximum).
    pub fn set(&mut self, gain: f32) {
        #[cfg(windows)]
        self.inner.set(gain);
        #[cfg(not(windows))]
        let _ = gain;
    }
}

#[cfg(windows)]
#[path = "session_volume_win.rs"]
mod win;
