// "Install yt-dlp" / "Install ffmpeg" button with progress. Shows nothing once the tool is there.

import { useEffect } from "react";
import type { YtTool } from "../types";
import { hasTool, TOOL_NAME, useTools } from "../lib/tools";

export function ToolInstall({ what, why }: { what: YtTool; why: string }) {
  const status = useTools((s) => s.status);
  const pct = useTools((s) => s.installing[what]);
  const install = useTools((s) => s.install);

  useEffect(() => {
    if (!useTools.getState().status) void useTools.getState().refresh();
  }, []);

  if (hasTool(status, what)) return null;
  const busy = pct !== undefined;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "var(--ambbg)", border: "1px solid var(--amb)", color: "var(--ambtx)" }}>
      <span style={{ fontSize: 13, flex: 1 }}>{TOOL_NAME[what]} is not installed. {why}</span>
      {busy ? (
        <span style={{ display: "flex", alignItems: "center", gap: 8, width: 160 }}>
          <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--p3)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--amb)" }} />
          </span>
          <span className="mono" style={{ fontSize: 12 }}>{Math.round(pct ?? 0)}%</span>
        </span>
      ) : (
        <button className="b btn" onClick={() => void install(what)} style={{ background: "var(--amb)", color: "var(--onamb)", fontWeight: 800 }}>
          Install {TOOL_NAME[what]}
        </button>
      )}
    </div>
  );
}
