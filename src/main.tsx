import React from "react";
import ReactDOM from "react-dom/client";

// Fonts are bundled (no Google Fonts at runtime: the school hall has no internet).
// The variable Archivo carries the width axis the condensed headings need (font-stretch: 75%).
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles.css";

import App from "./App";
import { startEngineSync } from "./lib/engineSync";

startEngineSync();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
