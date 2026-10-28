// StageGremlin: injected into the background player window (Spotify, YouTube (Music), SoundCloud, …) before the
// page's own scripts run. It does two things and nothing else:
//
//  1. Remote control: play / pause / next / previous, called from the app with
//     window.__cueplayBg.play() etc. It uses the same "media session" handlers the page registers
//     for the keyboard's media keys; if the page has none, it falls back to the <audio>/<video>
//     element itself.
//  2. Now playing: every half second it tells the app the title, artist, position and whether
//     the page is playing, through one allowed command (plugin:cueplay-bg|report).
//
// Volume is NOT done here: the app sets it in the Windows mixer, which works for any site.
(function () {
  if (window.top !== window) return; // only the main page, not adverts or other frames
  if (window.__cueplayBg) return;

  // --- 1. Remember the page's media key handlers ------------------------------------------
  var handlers = {};
  var positionState = null; // { duration, position, playbackRate, at }
  try {
    var ms = navigator.mediaSession;
    if (ms && typeof ms.setActionHandler === "function") {
      var origSet = ms.setActionHandler.bind(ms);
      ms.setActionHandler = function (action, handler) {
        handlers[action] = handler;
        return origSet(action, handler);
      };
    }
    if (ms && typeof ms.setPositionState === "function") {
      var origPos = ms.setPositionState.bind(ms);
      ms.setPositionState = function (state) {
        positionState = state ? {
          duration: state.duration,
          position: state.position,
          playbackRate: state.playbackRate || 1,
          at: Date.now()
        } : null;
        return origPos(state);
      };
    }
  } catch (e) { /* a page that blocks this still plays; we just lose the remote */ }

  // Some players keep their <audio>/<video> element out of the page, so we also catch it the
  // moment it starts playing.
  var lastMedia = null;
  try {
    var origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      lastMedia = this;
      return origPlay.apply(this, arguments);
    };
  } catch (e) {}

  function media() {
    if (lastMedia) return lastMedia;
    var list = document.querySelectorAll("audio, video");
    for (var i = 0; i < list.length; i++) {
      if (!list[i].paused) return list[i];
    }
    return list.length ? list[0] : null;
  }

  function callHandler(action) {
    var h = handlers[action];
    if (typeof h !== "function") return false;
    try { h({ action: action }); return true; } catch (e) { return false; }
  }

  // --- Track list (best effort, per source) ----------------------------------------------
  // The web players don't offer an API for this, so we read the rows the page shows. Class
  // names change when a site updates; if a source stops showing tracks, these selectors are
  // the place to fix. Returns [{ title, artist, el }] or null when this source isn't supported.
  var MAX_TRACKS = 100;

  function text(root, sel) {
    var n = root.querySelector(sel);
    return n ? (n.textContent || "").trim() : "";
  }

  function scrapeTracks() {
    var host = location.hostname;
    var out = [];
    var rows, i;
    if (host === "open.spotify.com") {
      // Rows of the playlist / album currently open in the main view.
      rows = document.querySelectorAll('[data-testid="tracklist-row"]');
      for (i = 0; i < rows.length && out.length < MAX_TRACKS; i++) {
        var title = text(rows[i], '[data-testid="internal-track-link"]') || text(rows[i], 'a[href*="/track/"]');
        var artists = rows[i].querySelectorAll('a[href*="/artist/"]');
        var names = [];
        for (var j = 0; j < artists.length; j++) names.push((artists[j].textContent || "").trim());
        if (title) out.push({ title: title, artist: names.join(", "), el: rows[i] });
      }
      return out;
    }
    if (host === "music.youtube.com") {
      // The "Up next" queue first; else the rows of the playlist that is open.
      rows = document.querySelectorAll("ytmusic-player-queue-item");
      if (rows.length) {
        for (i = 0; i < rows.length && out.length < MAX_TRACKS; i++) {
          var t = text(rows[i], ".song-title");
          if (t) out.push({ title: t, artist: text(rows[i], ".byline"), el: rows[i] });
        }
        return out;
      }
      rows = document.querySelectorAll("ytmusic-responsive-list-item-renderer");
      for (i = 0; i < rows.length && out.length < MAX_TRACKS; i++) {
        var t2 = text(rows[i], ".title");
        if (t2) out.push({ title: t2, artist: text(rows[i], ".secondary-flex-columns"), el: rows[i] });
      }
      return out;
    }
    if (host === "www.youtube.com" || host === "m.youtube.com") {
      // The playlist panel beside the video (only when a playlist is playing).
      rows = document.querySelectorAll("ytd-playlist-panel-video-renderer");
      for (i = 0; i < rows.length && out.length < MAX_TRACKS; i++) {
        var t3 = text(rows[i], "#video-title");
        if (t3) out.push({ title: t3, artist: text(rows[i], "#byline"), el: rows[i] });
      }
      return out;
    }
    return null;
  }

  /** Starts a row: its own play button when there is one, else a click / double-click on it. */
  function playRow(el) {
    var btn = el.querySelector('button[aria-label^="Play"], ytmusic-play-button-renderer, .song-info');
    if (btn) { btn.click(); return; }
    el.click();
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }

  // --- 2. Report to the app -----------------------------------------------------------------
  function isPlaying() {
    var m = media();
    if (m) return !m.paused && !m.ended;
    var ms = navigator.mediaSession;
    return !!(ms && ms.playbackState === "playing");
  }

  function readPosition() {
    if (positionState && isFinite(positionState.duration)) {
      var pos = positionState.position;
      if (isPlaying()) pos += (Date.now() - positionState.at) / 1000 * positionState.playbackRate;
      return { position: Math.min(pos, positionState.duration), duration: positionState.duration };
    }
    var m = media();
    if (m && isFinite(m.duration) && m.duration > 0) {
      return { position: m.currentTime, duration: m.duration };
    }
    return { position: null, duration: null };
  }

  // Signed in? false when the page shows a log-in button, true when it shows the account
  // (Spotify), null when we can't tell. Best effort: only used to warn, never to block.
  function signedIn() {
    try {
      if (location.hostname.indexOf("spotify.com") >= 0) {
        if (document.querySelector('[data-testid="login-button"]')) return false;
        if (document.querySelector('[data-testid="user-widget-link"], [data-testid="user-widget-avatar"]')) return true;
        return null;
      }
      var els = document.querySelectorAll("a, button, tp-yt-paper-button, ytmusic-button-renderer");
      for (var i = 0; i < els.length && i < 400; i++) {
        var t = (els[i].textContent || "").trim();
        if (/^(log ?in|sign ?in|inloggen|aanmelden)$/i.test(t)) return false;
      }
    } catch (e) {}
    return null;
  }

  // Spotify: the other device it plays on, from its "Playing on …" bar (null = this window, or can't tell).
  function remoteDevice() {
    if (location.hostname.indexOf("spotify.com") < 0) return null;
    try {
      var re = /^(playing on|listening on|afspelen op|luisteren op|speelt af op|bezig met afspelen op)\s+(.+)$/i;
      var els = document.querySelectorAll("footer *, [data-testid*='connect'] *, [aria-live] *");
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].textContent || "").trim();
        if (t.length > 90) continue;
        var m = re.exec(t);
        if (m) return m[2].trim();
      }
    } catch (e) {}
    return null;
  }

  function report() {
    var t = window.__TAURI_INTERNALS__;
    if (!t || typeof t.invoke !== "function") return;
    var meta = navigator.mediaSession && navigator.mediaSession.metadata;
    var p = readPosition();
    var tracks = null;
    try {
      var found = scrapeTracks();
      if (found) tracks = found.map(function (t) { return { title: t.title, artist: t.artist || null }; });
    } catch (e) {}
    var payload = {
      playing: isPlaying(),
      title: meta && meta.title ? String(meta.title) : null,
      artist: meta && meta.artist ? String(meta.artist) : null,
      position: p.position,
      duration: p.duration,
      hasMediaSession: Object.keys(handlers).length > 0,
      url: location.href,
      tracks: tracks,
      signedIn: signedIn(),
      connect: window.__cueplayConnect || null,
      remote: remoteDevice()
    };
    try {
      var r = t.invoke("plugin:cueplay-bg|report", { report: payload });
      if (r && typeof r.catch === "function") r.catch(function () {});
    } catch (e) {}
  }
  setInterval(report, 500);

  // --- Remote control, called by the app ----------------------------------------------------
  window.__cueplayBg = {
    play: function () {
      if (!callHandler("play")) {
        var m = media();
        if (m) { var r = m.play(); if (r && r.catch) r.catch(function () {}); }
      }
      setTimeout(report, 100);
    },
    // Spotify: start the playlist this page shows with its own big play button, on the device Spotify
    // is set to (the box after a move; this window otherwise). Falls back to plain play.
    startList: function () {
      var big = null;
      if (location.hostname.indexOf("spotify.com") >= 0) {
        var cands = document.querySelectorAll('[data-testid="action-bar-row"] [data-testid="play-button"], main [data-testid="play-button"]');
        for (var i = 0; i < cands.length && !big; i++) if (cands[i].getClientRects().length) big = cands[i];
      }
      if (big) {
        // Already playing this list: its button says "pause" then; leave it.
        if (!/pause|pauzeer/i.test(big.getAttribute("aria-label") || "")) big.click();
      } else {
        window.__cueplayBg.play();
      }
      setTimeout(report, 300);
    },
    pause: function () {
      // Spotify playing on another device (the box): its own pause button pauses THERE; the page's
      // media handlers only know this window.
      if (location.hostname.indexOf("spotify.com") >= 0 && remoteDevice()) {
        var pb = document.querySelector('[data-testid="control-button-playpause"]');
        if (pb && /pause|pauzeer/i.test(pb.getAttribute("aria-label") || "")) { pb.click(); setTimeout(report, 300); return; }
      }
      if (!callHandler("pause")) {
        var m = media();
        if (m) m.pause();
      }
      setTimeout(report, 100);
    },
    next: function () { callHandler("nexttrack"); setTimeout(report, 300); },
    // Spotify only: shuffle true/false and repeat "off"/"all"/"one" (null = leave it). Clicks the
    // page's own buttons until they say what we want (shuffle has 3 steps incl. Smart Shuffle,
    // repeat has 3 too), at most a few clicks so a changed page can't make us click forever.
    shuffleRepeat: function (shuffle, repeat) {
      if (location.hostname.indexOf("spotify.com") < 0) return;
      var tries = 0;
      (function step() {
        tries++;
        var busy = false;
        var sb = document.querySelector('[data-testid="control-button-shuffle"]');
        if (sb && shuffle !== null && shuffle !== undefined) {
          var on = sb.getAttribute("aria-checked") === "true";
          if (on !== !!shuffle) { sb.click(); busy = true; }
        }
        var rb = document.querySelector('[data-testid="control-button-repeat"]');
        if (rb && repeat) {
          var st = rb.getAttribute("aria-checked"); // "false" = off, "true" = all, "mixed" = one
          var now = st === "mixed" ? "one" : st === "true" ? "all" : "off";
          if (now !== repeat) { rb.click(); busy = true; }
        }
        if (busy && tries < 4) setTimeout(step, 600);
      })();
    },
    // Spotify only: play on another Spotify Connect device (e.g. the streambox) by clicking through
    // the player's own device list, like a person would. `names`: names the device may have (the
    // first one in the list that matches wins; spaces, underscores and capitals don't count);
    // empty = back to this window ("This web browser"). Best effort: Spotify changes its page now
    // and then. The outcome goes out with the next report (`connect`), so the app can say what happened.
    connect: function (names) {
      if (location.hostname.indexOf("spotify.com") < 0) return;
      var squash = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
      var wants = (names || []).map(squash).filter(function (w) { return w.length >= 3; });
      var self = /this (web )?browser|deze (web)?browser|web ?player|webspeler/i;
      var done = function (state, device, devices) {
        window.__cueplayConnect = { state: state, device: device || null, devices: devices || [], at: Date.now() };
        setTimeout(report, 50);
      };
      // A full press: Spotify's rows may listen for pointer/mouse down, not only click.
      var press = function (el) {
        var r = el.getBoundingClientRect();
        var at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
        try { el.dispatchEvent(new PointerEvent("pointerdown", at)); } catch (e) {}
        el.dispatchEvent(new MouseEvent("mousedown", at));
        try { el.dispatchEvent(new PointerEvent("pointerup", at)); } catch (e) {}
        el.dispatchEvent(new MouseEvent("mouseup", at));
        el.click();
      };
      // The smallest element whose own text (or tooltip) names the device: the name itself, not a
      // whole list that happens to contain it. Skips our own window's controls and hidden elements.
      var findName = function (test, scope) {
        var best = null;
        var more = /more|meer|opties|options/i;
        var all = (scope || document).querySelectorAll("span, div, p, button, li, a, [title], [aria-label]");
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var txt = (el.textContent || "").trim();
          var label = (el.getAttribute("title") || "") + " " + (el.getAttribute("aria-label") || "");
          if (!txt && !label.trim()) continue;
          if (txt.length > 80 && !test(label)) continue;
          if (!test(txt) && !test(label)) continue;
          if (!el.getClientRects().length) continue;
          if (more.test(el.getAttribute("aria-label") || "")) continue; // a row's "…" button
          if (!best || best.contains(el)) best = el; // a deeper match is a better match
        }
        return best;
      };
      // The row to press for a name: its nearest clickable ancestor, but never a "…" / more button.
      var rowOf = function (el) {
        var row = el.closest("button, [role='button'], [role='menuitem'], [role='option'], [role='menuitemradio'], a, li") || el;
        var aria = (row.getAttribute("aria-label") || "").toLowerCase();
        if (/more|meer|opties|options/.test(aria)) row = row.parentElement || row;
        return row;
      };
      var matchWant = function (want) { return function (t) { return squash(t).indexOf(want) >= 0; }; };
      // The device list: around "This web browser", which Spotify always lists. Climbing up from it,
      // the first box that holds a wanted name is the list; so a name elsewhere (the "Playing on …"
      // bar, which would just open the list again) never wins.
      var me = function () { return findName(function (t) { return self.test(t || ""); }); };
      var lookup = function () {
        var start = me();
        if (!wants.length) return start;
        if (!start) return null; // the list isn't showing
        for (var i = 0; i < wants.length; i++) {
          var box = start;
          for (var k = 0; box && k < 12; k++) {
            box = box.parentElement;
            var el = box && findName(matchWant(wants[i]), box);
            if (el) return el;
          }
        }
        return null;
      };
      // What the device list shows (for the message when nothing matched).
      var listed = function () {
        // The biggest box around "This web browser" that's still only a short list (not the page).
        var box = me(), list = null;
        for (var k = 0; box && k < 12; k++) {
          box = box.parentElement;
          var n = box ? (box.innerText || "").split("\n").filter(function (l) { return l.trim(); }).length : 99;
          if (n > 15) break;
          list = box;
        }
        var seen = [];
        ((list && list.innerText) || "").split("\n").forEach(function (line) {
          var t = line.trim();
          if (t && t.length < 60 && seen.indexOf(t) < 0 && seen.length < 8) seen.push(t);
        });
        return seen;
      };
      var opened = false;
      var openList = function () {
        var buttons = Array.prototype.slice.call(document.querySelectorAll("button[data-testid*='connect'], button[aria-label], [data-testid*='device'] button, button[data-testid*='device']"));
        var b = buttons.filter(function (x) {
          return /connect|verbind|apparaat|device/i.test((x.getAttribute("aria-label") || "") + " " + (x.getAttribute("data-testid") || ""));
        })[0];
        if (b) { press(b); opened = true; }
        return !!b;
      };
      // Already showing the list (the side panel stays open)? Then don't press the button: that would close it.
      if (!me() && !openList()) { done("no-button"); return; }
      var tries = 0;
      (function pick() {
        tries++;
        var hit = lookup();
        if (hit) {
          var row = rowOf(hit);
          press(row);
          done("ok", (hit.getAttribute("title") || hit.textContent || "").trim().slice(0, 60));
          // Close the list again if we opened it.
          if (opened) setTimeout(function () { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }, 400);
        } else if (tries < 12) {
          setTimeout(pick, 250); // the list fills in after a moment
        } else {
          done("no-device", null, listed());
          if (opened) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
      })();
    },
    prev: function () { callHandler("previoustrack"); setTimeout(report, 300); },
    // Plays row `index` of the list we last reported; `title` guards against the list having
    // changed in between (then we look the title up instead).
    playTrack: function (index, title) {
      var list = scrapeTracks() || [];
      var row = list[index];
      if (!row || row.title !== title) {
        row = null;
        for (var i = 0; i < list.length; i++) if (list[i].title === title) { row = list[i]; break; }
      }
      if (row) playRow(row.el);
      setTimeout(report, 300);
    },
    report: report
  };
})();
