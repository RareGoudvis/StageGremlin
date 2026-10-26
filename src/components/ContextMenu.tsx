// One right-click menu for the whole app. Components call openMenu(event, items) from
// onContextMenu; this renders the menu at the pointer, flips it at screen edges, and handles
// the keyboard (↑/↓ move, → opens a submenu, ← closes it, Enter picks, Esc closes).
// The browser's own context menu is switched off in App.tsx, except in text fields.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type MouseEvent } from "react";
import { create } from "zustand";

export type MenuItem =
  | "sep"
  | {
      label: string;
      onClick?: () => void;
      shortcut?: string;
      /** Shows a tick in front (toggles like "Duck background"). */
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      /** A colour swatch in front (colour menus). */
      swatch?: string | null;
      submenu?: MenuItem[];
    };

interface MenuStore {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  open: (x: number, y: number, items: MenuItem[]) => void;
  close: () => void;
}

export const useMenu = create<MenuStore>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null }),
}));

/** Use in onContextMenu: openMenu(e, [...items]). */
export function openMenu(e: MouseEvent | globalThis.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  useMenu.getState().open(e.clientX, e.clientY, items.filter((i, k, all) => !(i === "sep" && (k === 0 || all[k - 1] === "sep"))));
}

/**
 * Open a menu under a button (the File and View menus). The button must carry `data-menu`, so
 * clicking it again does not count as "clicking away" and the second click simply closes the menu.
 */
export function toggleMenuBelow(el: HTMLElement, items: MenuItem[]) {
  const r = el.getBoundingClientRect();
  const m = useMenu.getState();
  if (m.menu && m.menu.x === r.left && m.menu.y === r.bottom + 4) return m.close();
  m.open(r.left, r.bottom + 4, items);
}

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const close = useMenu((s) => s.close);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-menu]")) close();
    };
    const blur = () => close();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [menu, close]);
  if (!menu) return null;
  return <MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} root onDone={close} />;
}

function MenuList({ items, x, y, root, onDone, onBack, parentWidth = 0 }: {
  items: MenuItem[];
  x: number;
  y: number;
  root?: boolean;
  onDone: () => void;
  /** Close this submenu (← key) and give focus back to the parent. */
  onBack?: () => void;
  parentWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const live = items.map((it, i) => (it !== "sep" && !it.disabled ? i : -1)).filter((i) => i >= 0);

  // Flip at the screen edges once we know the menu's size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 4) left = Math.max(4, (parentWidth ? x - parentWidth - r.width : x - r.width));
    if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
    setPos({ left, top });
    el.focus();
  }, [x, y, parentWidth]);

  const openSub = (i: number) => {
    const row = ref.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    const r = row?.getBoundingClientRect();
    const w = ref.current?.getBoundingClientRect().width ?? 0;
    if (r) setSub({ index: i, x: r.right - 2, y: r.top - 5 });
    void w;
  };

  const pick = (i: number) => {
    const it = items[i];
    if (it === "sep" || !it || it.disabled) return;
    if (it.submenu) return openSub(i);
    onDone();
    it.onClick?.();
  };

  const onKey = (e: RKeyboardEvent) => {
    // The menu owns the keyboard while open (Space must not reach GO).
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    if (sub) return;
    const k = live.indexOf(active);
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(live[(k + 1) % live.length] ?? -1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(live[(k - 1 + live.length) % live.length] ?? -1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); const it = items[active]; if (it !== "sep" && it?.submenu) openSub(active); }
    else if (e.key === "ArrowLeft" && onBack) { e.preventDefault(); onBack(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (active >= 0) pick(active); }
    else if (e.key === "Escape") { e.preventDefault(); if (onBack) onBack(); else onDone(); }
  };

  return (
    <>
      <div
        ref={ref}
        data-menu
        role="menu"
        tabIndex={-1}
        onKeyDown={onKey}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "fixed", left: pos.left, top: pos.top, zIndex: root ? 120 : 121, minWidth: 210, maxWidth: 320,
          maxHeight: "calc(100vh - 8px)", overflowY: "auto", padding: 4, borderRadius: 10,
          background: "var(--p1)", border: "1px solid var(--line)", boxShadow: "0 12px 32px rgba(0,0,0,.35)", outline: "none",
          fontSize: 13.5, color: "var(--text)",
        }}
      >
        {items.map((it, i) =>
          it === "sep" ? (
            <div key={i} role="separator" style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
          ) : (
            <div
              key={i}
              data-i={i}
              role="menuitem"
              aria-disabled={it.disabled}
              aria-haspopup={it.submenu ? "menu" : undefined}
              onPointerEnter={() => {
                setActive(i);
                if (it.submenu && !it.disabled) openSub(i);
                else setSub(null);
              }}
              onClick={() => pick(i)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6,
                cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.45 : 1,
                // Highlight = inverted, like the pressed chips: never text-on-same-colour.
                background: active === i && !it.disabled ? "var(--hl)" : "transparent",
                color: active === i && !it.disabled ? "var(--bg)" : it.danger ? "var(--redtx)" : "var(--text)",
              }}
            >
              <span style={{ width: 14, textAlign: "center", flex: "none" }}>{it.checked ? "✓" : ""}</span>
              {it.swatch !== undefined && (
                <span style={{ width: 12, height: 12, borderRadius: 6, flex: "none", background: it.swatch ?? "transparent", border: it.swatch ? "none" : "1px dashed var(--mute)" }} />
              )}
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
              {it.shortcut && <span className="mono" style={{ fontSize: 11, opacity: 0.65 }}>{it.shortcut}</span>}
              {it.submenu && <span style={{ fontSize: 11 }}>▸</span>}
            </div>
          ),
        )}
      </div>
      {sub && items[sub.index] !== "sep" && (items[sub.index] as { submenu?: MenuItem[] }).submenu && (
        <MenuList
          key={sub.index}
          items={(items[sub.index] as { submenu: MenuItem[] }).submenu}
          x={sub.x}
          y={sub.y}
          parentWidth={ref.current?.getBoundingClientRect().width ?? 0}
          onDone={onDone}
          onBack={() => {
            setSub(null);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}
