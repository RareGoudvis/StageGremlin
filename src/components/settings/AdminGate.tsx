// Wraps settings only the admin may change. Locked: they show greyed out, with a password box above.
// Normal builds carry one built-in admin password (see lib/admin.ts). A build without one lets each
// laptop set its own; until then nothing in here is editable.

import { useState, type ReactNode } from "react";
import { hasBuiltInPassword, lockAdmin, setAdminPassword, unlockAdmin, useAdmin, useHasAdminPassword } from "../../lib/admin";
import { useT } from "../../i18n";

export function AdminGate({ children }: { children: ReactNode }) {
  const t = useT();
  const hasPassword = useHasAdminPassword();
  const unlocked = useAdmin((s) => s.unlocked);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [wrong, setWrong] = useState(false);
  const [changing, setChanging] = useState(false);

  const tryUnlock = async () => {
    const ok = await unlockAdmin(pw);
    setWrong(!ok);
    setPw("");
  };
  const savePassword = async () => {
    if (pw.length < 4 || pw !== pw2) return;
    await setAdminPassword(pw);
    setPw("");
    setPw2("");
    setChanging(false);
  };
  const box = { width: 200, height: 36 };

  // Setting a password: the first time, or "Change password" while unlocked.
  if (!hasPassword || changing) {
    return (
      <>
        <section style={{ borderRadius: 14, padding: "16px 20px", background: "var(--ambbg)", color: "var(--ambtx)", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{hasPassword ? t("admin.change") : t("admin.setFirst")}</span>
          <span style={{ fontSize: 13 }}>{t("admin.why")}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" type="password" autoComplete="new-password" aria-label={t("admin.new")} placeholder={t("admin.new")} value={pw} onChange={(e) => setPw(e.target.value)} style={box} />
            <input className="input" type="password" autoComplete="new-password" aria-label={t("admin.repeat")} placeholder={t("admin.repeat")} value={pw2} onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void savePassword()} style={box} />
            <button className="b btn btn-go" disabled={pw.length < 4 || pw !== pw2} onClick={() => void savePassword()}>{t("admin.save")}</button>
            {changing && <button className="b btn btn-ghost" onClick={() => setChanging(false)}>{t("cancel")}</button>}
          </div>
          {pw2.length > 0 && pw !== pw2 && <span style={{ fontSize: 12.5 }}>{t("admin.mismatch")}</span>}
        </section>
        {changing && children}
        {!changing && <Locked>{children}</Locked>}
      </>
    );
  }

  if (!unlocked) {
    return (
      <>
        <section style={{ borderRadius: 14, padding: "14px 20px", border: "1px solid var(--line)", background: "var(--p1)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 200 }}>{t("admin.locked")}</span>
          <input className="input" type="password" autoComplete="current-password" aria-label={t("admin.password")} placeholder={t("admin.password")} value={pw}
            onChange={(e) => { setPw(e.target.value); setWrong(false); }} onKeyDown={(e) => e.key === "Enter" && void tryUnlock()} style={box} />
          <button className="b btn" disabled={!pw} onClick={() => void tryUnlock()}>{t("admin.unlock")}</button>
          {wrong && <span style={{ fontSize: 12.5, color: "var(--redtx)", width: "100%" }}>{t("admin.wrong")}</span>}
        </section>
        <Locked>{children}</Locked>
      </>
    );
  }

  return (
    <>
      <section style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: "var(--acc)", fontWeight: 700, flex: 1 }}>{t("admin.unlocked")}</span>
        {/* The built-in password is changed by making a new build, not here. */}
        {!hasBuiltInPassword && <button className="b btn btn-ghost" onClick={() => setChanging(true)}>{t("admin.changeBtn")}</button>}
        <button className="b btn" onClick={lockAdmin}>{t("admin.lock")}</button>
      </section>
      {children}
    </>
  );
}

/** Greyed out and untouchable: a disabled fieldset blocks every control inside it. */
function Locked({ children }: { children: ReactNode }) {
  return (
    <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 18, opacity: 0.55 }}>
      {children}
    </fieldset>
  );
}
