// Where does the background music really go? The background player is a WebView2 window: Windows
// plays its sound on the DEFAULT output device, not on the show output StageGremlin picked. So the
// background only reaches the Qu-24 when the Qu-24 is also the Windows default. (Review #7.)
//
// Also worth knowing: background music never passes the master limiter (it is not in the audio
// engine), and neither does the headphone preview (its own device, by design).

import { useEffect, useState } from "react";
import { call } from "./tauri";
import { useEngine } from "../engineStore";
import { sameDevice } from "./decisions";

export interface BgRouting {
  /** Windows' default output (null = unknown). */
  defaultName: string | null;
  /** The show output (null = engine not ready). */
  showName: string | null;
  /** True when the background music goes to the same device as the show. */
  same: boolean;
  known: boolean;
}

/** Asks Windows every few seconds (the default device can change any time). */
export function useBgRouting(): BgRouting {
  const showName = useEngine((s) => s.output?.outputName ?? null);
  const [defaultName, setDefaultName] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  useEffect(() => {
    let alive = true;
    const ask = () =>
      call("audio_default_output")
        .then((r) => {
          if (!alive) return;
          setDefaultName(r.name);
          setKnown(true);
        })
        .catch(() => alive && setKnown(false));
    ask();
    const t = setInterval(ask, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return { defaultName, showName, same: sameDevice(defaultName, showName), known };
}

export function openSoundSettings() {
  void call("open_sound_settings").catch(() => {});
}
