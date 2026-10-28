// The admin password: guards settings a teacher using the app shouldn't change (the AUDAC setup:
// address, zone and input names, which ones show). Unlocked lasts until Lock is pressed, the app
// closes, or Settings has stayed closed for half an hour (someone else may use the laptop by then).
//
// Where the password comes from:
// - Builds made with scripts/release.ps1 carry ONE hash for every install, from VITE_ADMIN_HASH in
//   .env.local (made by `node scripts/make-admin-hash.mjs`; that file is never committed).
// - A build without it (dev mode, someone else's fork) lets each laptop set its own, stored in
//   settings.json as `adminHash`.
// Only a slow hash is ever stored: "pbkdf2:<rounds>:<salt hex>:<hash hex>" (PBKDF2-SHA256), so a copied
// hash takes ages per guess. scripts/make-admin-hash.mjs makes the same format.

import { create } from "zustand";
import { useSettings } from "../settingsStore";

const ROUNDS = 600_000;
const BUILT_IN: string = (import.meta.env.VITE_ADMIN_HASH ?? "").trim();

/** True when this build has the one shared admin password (no per-laptop password to set or change). */
export const hasBuiltInPassword = BUILT_IN.startsWith("pbkdf2:");

interface AdminStore {
  unlocked: boolean;
  setUnlocked: (on: boolean) => void;
}

export const useAdmin = create<AdminStore>((set) => ({
  unlocked: false,
  setUnlocked: (unlocked) => set({ unlocked }),
}));

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256);
  return hex(new Uint8Array(bits));
}

/** Does `password` match a stored "pbkdf2:…" string? */
async function matches(stored: string, password: string): Promise<boolean> {
  const [kind, rounds, salt, hash] = stored.split(":");
  if (kind !== "pbkdf2" || !rounds || !salt || !hash) return false;
  return (await pbkdf2(password, fromHex(salt), Number(rounds))) === hash;
}

/** Is there any admin password (built in, or set on this laptop)? */
export function useHasAdminPassword(): boolean {
  const own = useSettings((s) => !!s.ui.adminHash);
  return hasBuiltInPassword || own;
}

/** Per-laptop password (only for builds without a built-in one). Unlocks right away. */
export async function setAdminPassword(password: string) {
  if (hasBuiltInPassword) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  useSettings.getState().update({ adminHash: `pbkdf2:${ROUNDS}:${hex(salt)}:${await pbkdf2(password, salt, ROUNDS)}` });
  useAdmin.getState().setUnlocked(true);
}

/** True (and unlocked) when the password is right. */
export async function unlockAdmin(password: string): Promise<boolean> {
  const stored = BUILT_IN || useSettings.getState().ui.adminHash;
  const ok = await matches(stored, password);
  if (ok) useAdmin.getState().setUnlocked(true);
  return ok;
}

export const lockAdmin = () => {
  window.clearTimeout(lockTimer);
  useAdmin.getState().setUnlocked(false);
};

/** Settings stays closed this long → locked again. */
const LOCK_AFTER_MS = 30 * 60_000;
let lockTimer = 0;

/** Settings opened: stay unlocked. Settings closed: lock after half an hour unless it opens again. */
export function settingsOpen(open: boolean) {
  window.clearTimeout(lockTimer);
  if (!open && useAdmin.getState().unlocked) lockTimer = window.setTimeout(lockAdmin, LOCK_AFTER_MS);
}
