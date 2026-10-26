// StageGremlin: injected into the background player window (Spotify, YouTube Music, …) before the
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
      tracks: tracks
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
    pause: function () {
      if (!callHandler("pause")) {
        var m = media();
        if (m) m.pause();
      }
      setTimeout(report, 100);
    },
    next: function () { callHandler("nexttrack"); setTimeout(report, 300); },
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
