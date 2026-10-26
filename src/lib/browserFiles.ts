// Browser mode only: files the operator picked with a file input.
//
// A browser can't give us real file paths, so each picked file gets a key like
// "browser:3/Intro.mp3" that goes into `cue.file`. The key ends in the real file name, so the
// extension checks (isAudioPath) still work. The File itself stays in memory in this tab:
// after a reload, or in a show opened from disk, the audio has to be imported again.

const files = new Map<string, File>();
let counter = 0;

export const BROWSER_PREFIX = "browser:";

export function isBrowserKey(key: string): boolean {
  return key.startsWith(BROWSER_PREFIX);
}

export function registerFile(f: File): string {
  const key = `${BROWSER_PREFIX}${++counter}/${f.name}`;
  files.set(key, f);
  return key;
}

export function fileFor(key: string): File | undefined {
  return files.get(key);
}

/** Opens the browser's file picker. Resolves with [] when the operator cancels. */
export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    let done = false;
    const finish = (list: File[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(list);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** Saves text as a download (browser "Save"). */
export function downloadText(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
