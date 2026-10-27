// The names the MTX itself keeps (set long ago in its Flash web portal), turned into
// StageGremlin's zone and input names. Pure, so it can be tested.
//
// The MTX's 30 names (protocol.rs, NAMES): 1–8 = zones, 9–14 = inputs 1–6, then per zone two names
// for inputs 7 and 8 (the wall-panel inputs). We use zone 1's pair (15, 16) for inputs 7 and 8.

export interface NamedItem {
  name: string;
  show: boolean;
}

export const DEFAULT_ZONE_NAMES = Array.from({ length: 8 }, (_, i) => `Zone ${i + 1}`);
export const DEFAULT_INPUT_NAMES = ["Mic 1", "Mic 2", "Line 3", "Line 4", "Line 5", "Line 6", "WLI/MWX65", "WMI"];

/** The MTX's zone and input names; "" where it gave none. Null when it hasn't sent any yet. */
export function mtxNames(names: string[] | undefined): { zones: string[]; inputs: string[] } | null {
  if (!names || !names.some((n) => n.trim())) return null;
  const at = (i: number) => (names[i] ?? "").trim();
  return {
    zones: Array.from({ length: 8 }, (_, i) => at(i)),
    inputs: [...Array.from({ length: 6 }, (_, i) => at(8 + i)), at(14), at(15)],
  };
}

/**
 * Put the MTX's names in. `onlyDefaults`: only replace names nobody has changed here yet
 * ("Zone 3", "Line 4"), so a name typed in StageGremlin always wins. Ticks stay as they are.
 */
export function applyMtxNames(list: NamedItem[], fromMtx: string[], defaults: string[], onlyDefaults: boolean): NamedItem[] {
  return list.map((x, i) => {
    const mtx = fromMtx[i];
    if (!mtx) return x;
    if (onlyDefaults && x.name.trim() !== defaults[i]) return x;
    return { ...x, name: mtx };
  });
}
