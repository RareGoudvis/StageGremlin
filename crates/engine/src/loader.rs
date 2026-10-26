//! Opens audio files on a helper thread.
//!
//! Opening a file means reading its header and probing the format. On a slow disk or USB
//! stick that can take tens of milliseconds, and the engine thread must never wait for it:
//! pre-waits, follow triggers and GO all run on that thread. So the engine only *asks* for a
//! file here and picks the opened file up on a later tick, without ever blocking.

use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};

use kira::sound::streaming::StreamingSoundData;
use kira::sound::FromFileError;

pub type Data = StreamingSoundData<FromFileError>;
pub type LoadResult = (PathBuf, Result<Data, String>);

pub struct Loader {
    requests: Sender<PathBuf>,
    results: Receiver<LoadResult>,
}

impl Loader {
    pub fn new() -> Self {
        let (req_tx, req_rx) = channel::<PathBuf>();
        let (res_tx, res_rx) = channel::<LoadResult>();
        std::thread::Builder::new()
            .name("cueplay-file-loader".into())
            .spawn(move || {
                // Ends by itself when the engine (and so the request sender) is dropped.
                while let Ok(path) = req_rx.recv() {
                    let result = StreamingSoundData::from_file(&path).map_err(|e| format!("cannot open {}: {e}", path.display()));
                    if res_tx.send((path, result)).is_err() {
                        break;
                    }
                }
            })
            .expect("could not start the file loader thread");
        Self { requests: req_tx, results: res_rx }
    }

    /// Asks for a file to be opened. Never blocks.
    pub fn request(&self, path: PathBuf) {
        let _ = self.requests.send(path);
    }

    /// One finished file, if any. Never blocks.
    pub fn try_recv(&self) -> Option<LoadResult> {
        match self.results.try_recv() {
            Ok(r) => Some(r),
            Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => None,
        }
    }
}

impl Default for Loader {
    fn default() -> Self {
        Self::new()
    }
}
