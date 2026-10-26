// Makes the admin password's hash for your builds. Run from the repo root:
//
//   node scripts/make-admin-hash.mjs
//
// It asks for the password twice (nothing is shown while you type), then writes
//   VITE_ADMIN_HASH=pbkdf2:600000:<salt>:<hash>
// into .env.local. scripts/release.ps1 builds with it, so every install from this laptop shares the
// one password. .env.local is in .gitignore: neither the password nor its hash ever goes into git.
// Same format as src/lib/admin.ts (PBKDF2-SHA256): change one, change both.

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ROUNDS = 600_000;

/** Read a line without echoing it (raw mode); Ctrl+C stops. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let text = "";
    const onData = (ch) => {
      if (ch === "\u0003") process.exit(1);
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(text);
      } else if (ch === "\u0008" || ch === "\u007f") {
        text = text.slice(0, -1);
      } else {
        text += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const first = await askHidden("Admin password: ");
const again = await askHidden("Same again:     ");
if (first !== again) {
  console.error("The two passwords are not the same. Nothing was written.");
  process.exit(1);
}
if (first.length < 10) {
  console.error("Use at least 10 characters (a short sentence is best): the build is public, so the hash can be tried offline.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(first, salt, ROUNDS, 32, "sha256").toString("hex");
const line = `VITE_ADMIN_HASH=pbkdf2:${ROUNDS}:${salt.toString("hex")}:${hash}`;

// Keep any other lines already in .env.local.
const old = existsSync(".env.local") ? readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("VITE_ADMIN_HASH=")) : [];
writeFileSync(".env.local", [...old, line].join("\n") + "\n");
console.log("Written to .env.local. The next build (scripts/release.ps1, or npm run tauri dev) uses it.");
