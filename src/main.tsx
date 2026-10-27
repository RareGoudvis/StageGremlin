import React from "react";
import ReactDOM from "react-dom/client";

// Fonts are bundled (no Google Fonts at runtime: the school hall has no internet).
// The variable Archivo carries the width axis the condensed headings need (font-stretch: 75%).
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles.css";

import App from "./App";
import { tellCarriedOver } from "./lib/settingsTransfer";
import { startEngineSync } from "./lib/engineSync";
import { installEmergencyKeys } from "./lib/emergencyKeys";
import { useSettings } from "./settingsStore";

startEngineSync();
// First keyboard listener of all: Stop all / Panic work even with a dialog open (see emergencyKeys.ts).
installEmergencyKeys();
void useSettings.getState().load().then(tellCarriedOver);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
