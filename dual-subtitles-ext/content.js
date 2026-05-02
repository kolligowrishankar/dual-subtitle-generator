/**
 * content.js — Dual Subtitle Generator v2
 *
 * Three subtitle sources:
 *
 * 1. YOUTUBE  → asks background.js to fetch transcript, receives via stream
 * 2. NETFLIX  → reads subtitle text directly from DOM (.player-timedtext span)
 * 3. AMAZON   → reads subtitle text directly from DOM (.atvwebplayersdk-captions-overlay)
 * 4. ANY SITE → tries DOM subtitle reading, then shows overlay with video found msg
 *
 * For Netflix/Amazon: no translation delay — we intercept each subtitle as it
 * appears on screen and translate it on the fly (single cue = ~100ms).
 */

(function () {
  "use strict";

  const POLL_MS   = 33;
  const LOOKAHEAD = 0.2;
  const MAX_RETRY = 3;

  // ── Site detection ────────────────────────────────────────────────────────
  const host = window.location.hostname;
  const isYouTube = host.includes("youtube.com");
  const isNetflix = host.includes("netflix.com");
  const isAmazon  = host.includes("amazon.") || host.includes("primevideo.com");

  // ── State ─────────────────────────────────────────────────────────────────
  let subtitles   = [];
  let currentIdx  = -1;
  let lastVideoId = null;
  let overlay     = null;
  let pollTimer   = null;
  let domWatcher  = null;
  let resizeTimer = null;
  let totalCues   = 0;
  let hoverActive = false;

  // Last DOM-sourced subtitle to avoid re-translating same text
  let lastDomGerman  = "";
  let lastDomEnglish = "";
  let translating    = false;

  // ── Overlay ───────────────────────────────────────────────────────────────
  function createOverlay() {
    const old = document.getElementById("dual-sub-overlay");
    if (old) old.remove();
    overlay = document.createElement("div");
    overlay.id = "dual-sub-overlay";
    Object.assign(overlay.style, {
      position:      "fixed",
      zIndex:        "2147483647",
      textAlign:     "center",
      pointerEvents: "auto",
      padding:       "10px 24px",
      borderRadius:  "8px",
      background:    "rgba(0,0,0,0.70)",
      display:       "none",
      maxWidth:      "88vw",
    });

    const deEl = document.createElement("div");
    deEl.id = "dual-sub-de";
    Object.assign(deEl.style, {
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize:   "2.2rem",
      fontWeight: "700",
      color:      "#FFD700",
      lineHeight: "1.4",
      textShadow: "0 2px 8px rgba(0,0,0,1)",
      whiteSpace: "pre-wrap",
      wordBreak:  "break-word",
      cursor:     "default",
    });

    const enEl = document.createElement("div");
    enEl.id = "dual-sub-en";
    Object.assign(enEl.style, {
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize:   "1.7rem",
      fontWeight: "400",
      color:      "#FFFFFF",
      lineHeight: "1.4",
      textShadow: "0 1px 6px rgba(0,0,0,1)",
      marginTop:  "4px",
      whiteSpace: "pre-wrap",
      wordBreak:  "break-word",
    });

    overlay.appendChild(deEl);
    overlay.appendChild(enEl);
    document.body.appendChild(overlay);
  }

  function positionOverlay() {
    if (!overlay) return;
    const video = getVideoElement();
    if (!video) return;
    const r = video.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    overlay.style.left   = r.left + "px";
    overlay.style.width  = r.width + "px";
    overlay.style.top    = "auto";

    // Netflix/Amazon: subtitles are usually at bottom-centre already
    // Push our overlay just above the native caption area
    const bottomOffset = (isNetflix || isAmazon) ? 120 : 72;
    overlay.style.bottom = (window.innerHeight - r.bottom + bottomOffset) + "px";
  }

  // ── Word hover highlight ──────────────────────────────────────────────────
  function renderWithHover(german, english) {
    const deEl = overlay.querySelector("#dual-sub-de");
    const enEl = overlay.querySelector("#dual-sub-en");

    const deTokens = german.split(/(\s+)/);
    const enTokens = english.split(/(\s+)/);
    const deWords  = deTokens.filter(w => w.trim().length > 0);
    const enWords  = enTokens.filter(w => w.trim().length > 0);

    deEl.innerHTML = "";
    let di = 0;
    deTokens.forEach(tok => {
      if (!tok.trim()) { deEl.appendChild(document.createTextNode(tok)); return; }
      const span = document.createElement("span");
      span.textContent    = tok;
      span.dataset.wi     = di;
      span.style.cursor   = "pointer";
      span.style.borderRadius = "3px";
      span.addEventListener("mouseenter", () => {
        if (!isVideoPaused()) return;
        hoverActive = true;
        highlightEn(parseInt(span.dataset.wi), deWords.length, enWords.length, enEl, enTokens);
        span.style.background = "rgba(255,215,0,0.3)";
        span.style.color      = "#fff";
      });
      span.addEventListener("mouseleave", () => {
        hoverActive = false;
        span.style.background = "";
        span.style.color      = "#FFD700";
        clearEnHighlight(enEl);
      });
      deEl.appendChild(span);
      di++;
    });

    renderEnPlain(enEl, enTokens);
  }

  function renderEnPlain(enEl, tokens) {
    enEl.innerHTML = "";
    let i = 0;
    tokens.forEach(tok => {
      if (!tok.trim()) { enEl.appendChild(document.createTextNode(tok)); return; }
      const s = document.createElement("span");
      s.textContent   = tok;
      s.dataset.wi    = i++;
      enEl.appendChild(s);
    });
  }

  function highlightEn(di, dLen, eLen, enEl, enTokens) {
    clearEnHighlight(enEl);
    if (!eLen || !dLen) return;
    const ratio  = eLen / dLen;
    const eStart = Math.floor(di * ratio);
    const eEnd   = Math.min(eLen - 1, Math.floor((di + 1) * ratio));
    enEl.querySelectorAll("span").forEach(s => {
      if (+s.dataset.wi >= eStart && +s.dataset.wi <= eEnd) {
        Object.assign(s.style, { background: "rgba(255,165,0,0.5)", color: "#FFE066", fontWeight: "700", borderRadius: "3px", padding: "0 2px" });
      }
    });
  }

  function clearEnHighlight(enEl) {
    enEl.querySelectorAll("span").forEach(s => {
      s.style.background = s.style.color = s.style.fontWeight = s.style.padding = "";
    });
  }

  function isVideoPaused() {
    const v = getVideoElement(); return v ? v.paused : true;
  }

  // ── Status banner ─────────────────────────────────────────────────────────
  function showStatus(msg, color) {
    let b = document.getElementById("dual-sub-status");
    if (!b) {
      b = document.createElement("div");
      b.id = "dual-sub-status";
      Object.assign(b.style, {
        position: "fixed", zIndex: "2147483647", left: "50%",
        transform: "translateX(-50%)", padding: "5px 16px",
        borderRadius: "4px", fontSize: "0.82rem", color: "#fff",
        pointerEvents: "none", whiteSpace: "nowrap", fontFamily: "monospace",
      });
      document.body.appendChild(b);
    }
    const video = getVideoElement();
    b.style.top        = ((video ? video.getBoundingClientRect().top : 0) + 10) + "px";
    b.style.background = color || "rgba(0,80,160,0.9)";
    b.textContent      = msg;
    b.style.display    = "block";
  }
  function hideStatus() {
    const b = document.getElementById("dual-sub-status");
    if (b) b.style.display = "none";
  }

  function showCue(german, english) {
    if (!overlay) return;
    renderWithHover(german, english);
    overlay.style.display = "block";
    positionOverlay();
  }

  function hideCue() {
    if (!hoverActive && overlay) overlay.style.display = "none";
  }

  // ── Video element ─────────────────────────────────────────────────────────
  function getVideoElement() {
    const all = Array.from(document.querySelectorAll("video"));
    return all.find(v => !v.paused && v.readyState >= 2)
        || all.find(v => v.readyState >= 2)
        || all[0] || null;
  }

  // ── Binary search cue lookup (YouTube mode) ───────────────────────────────
  function findCueIndex(time) {
    let lo = 0, hi = subtitles.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (subtitles[mid].start <= time) { found = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (found === -1) return -1;
    return subtitles[found].end > time ? found : -1;
  }

  function resolveCueIndex(time) {
    const t = time + LOOKAHEAD;
    if (currentIdx >= 0) {
      const c = subtitles[currentIdx];
      if (t >= c.start && t < c.end) return currentIdx;
    }
    const next = currentIdx + 1;
    if (next < subtitles.length) {
      const n = subtitles[next];
      if (t >= n.start && t < n.end) return next;
      if (t < n.start) return -1;
    }
    return findCueIndex(t);
  }

  // ── DOM subtitle reader (Netflix / Amazon / Generic) ─────────────────────
  function readDomSubtitle() {
    let text = "";

    if (isNetflix) {
      // Netflix renders into .player-timedtext-text-container spans
      const els = document.querySelectorAll(
        ".player-timedtext span, .nfp-player-timedtext span, [data-uia='player-timedtext'] span"
      );
      text = Array.from(els).map(e => e.textContent).join(" ").trim();
    }

    if (isAmazon) {
      // Amazon Prime renders into .atvwebplayersdk-captions-text
      const els = document.querySelectorAll(
        ".atvwebplayersdk-captions-text, .captions-text, [class*='captions'] span"
      );
      text = Array.from(els).map(e => e.textContent).join(" ").trim();
    }

    if (!isNetflix && !isAmazon) {
      // Generic: look for <track> elements or common subtitle containers
      const els = document.querySelectorAll(
        ".vjs-text-track-display span, .subtitle, .subtitles, [class*='subtitle'] span, " +
        "[class*='caption'] span, .caption-text, .sub-text"
      );
      text = Array.from(els).map(e => e.textContent).join(" ").trim();
    }

    return text;
  }

  // Translate a single cue via background.js
  function translateDomCue(german) {
    if (translating) return;
    translating = true;
    chrome.runtime.sendMessage(
      { type: "TRANSLATE_BATCH", texts: [german] },
      (response) => {
        translating = false;
        if (response && response.ok && response.translated[0]) {
          lastDomEnglish = response.translated[0];
          showCue(lastDomGerman, lastDomEnglish);
        }
      }
    );
  }

  // ── Poll loop ─────────────────────────────────────────────────────────────
  function tick() {
    const video = getVideoElement();
    if (!video) return;
    positionOverlay();

    if (hoverActive) return;

    // ── Netflix / Amazon / Generic DOM mode ──
    if (!isYouTube) {
      const domText = readDomSubtitle();

      if (!domText) {
        hideCue();
        return;
      }

      if (domText !== lastDomGerman) {
        lastDomGerman  = domText;
        lastDomEnglish = "…";          // show placeholder instantly
        showCue(domText, "translating…");
        translateDomCue(domText);
      }
      return;
    }

    // ── YouTube transcript mode ──
    if (video.paused || subtitles.length === 0) return;
    const idx = resolveCueIndex(video.currentTime);
    if (idx === currentIdx) return;
    currentIdx = idx;
    if (idx === -1) hideCue();
    else showCue(subtitles[idx].german, subtitles[idx].english);
  }

  // ── Stream handler (YouTube) ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "SUB_ERROR") {
      showStatus(`❌ DualSub: ${msg.error}`, "rgba(160,0,0,0.9)");
      return;
    }
    if (msg.type !== "SUB_STREAM") return;
    const p = msg.payload;

    if (p.type === "header") {
      showStatus(`⏳ Translating ${p.total} cues…`);
      return;
    }
    if (p.type === "batch") {
      subtitles = subtitles.concat(p.cues).sort((a, b) => a.start - b.start);
      totalCues += p.cues.length;
      if (totalCues === p.cues.length)
        showStatus(`✅ First ${totalCues} cues ready!`, "rgba(0,120,60,0.9)");
      else
        showStatus(`✅ ${totalCues} cues loaded…`, "rgba(0,120,60,0.9)");
      return;
    }
    if (p.type === "done") {
      showStatus(`✅ All ${p.total} cues ready`, "rgba(0,120,60,0.9)");
      setTimeout(hideStatus, 3000);
      return;
    }
    if (p.type === "error") {
      showStatus(`❌ DualSub: ${p.error}`, "rgba(160,0,0,0.9)");
    }
  });

  // ── Ping-retry helper ─────────────────────────────────────────────────────
  function sendToBackground(payload, callback, tries) {
    tries = tries === undefined ? MAX_RETRY : tries;
    chrome.runtime.sendMessage({ type: "PING" }, () => {
      if (chrome.runtime.lastError) {
        if (tries > 0) setTimeout(() => sendToBackground(payload, callback, tries - 1), 800);
        else callback({ ok: false, error: "Service worker unavailable" });
        return;
      }
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          if (tries > 0) setTimeout(() => sendToBackground(payload, callback, tries - 1), 800);
          else callback({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        callback(res || { ok: true });
      });
    });
  }

  // ── YouTube subtitle loader ───────────────────────────────────────────────
  function loadYouTubeSubtitles(videoId) {
    lastVideoId = videoId;
    subtitles   = [];
    currentIdx  = -1;
    totalCues   = 0;
    hoverActive = false;
    hideCue();
    showStatus("⏳ DualSub: fetching transcript…");

    sendToBackground({ type: "FETCH_YOUTUBE_TRANSCRIPT", videoId }, (res) => {
      if (!res || !res.ok) showStatus(`❌ DualSub: ${res?.error || "no response"}`, "rgba(160,0,0,0.9)");
    });
  }

  function getYouTubeId() {
    return new URLSearchParams(window.location.search).get("v") || null;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function start() {
    createOverlay();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(tick, POLL_MS);

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer); resizeTimer = setTimeout(positionOverlay, 100);
    });
    document.addEventListener("fullscreenchange", () => setTimeout(positionOverlay, 200));

    if (isYouTube) {
      new MutationObserver(() => {
        const vid = getYouTubeId();
        if (vid && vid !== lastVideoId) loadYouTubeSubtitles(vid);
      }).observe(document.querySelector("title") || document.head, { childList: true, subtree: true });

      const vid = getYouTubeId();
      if (vid) loadYouTubeSubtitles(vid);

    } else if (isNetflix || isAmazon) {
      // DOM mode — no loading needed, subtitles appear as video plays
      showStatus(
        isNetflix ? "✅ DualSub active — Netflix mode" : "✅ DualSub active — Prime mode",
        "rgba(0,120,60,0.9)"
      );
      setTimeout(hideStatus, 4000);

    } else {
      // Generic site
      showStatus("✅ DualSub active — watching for subtitles", "rgba(0,80,160,0.9)");
      setTimeout(hideStatus, 4000);
    }
  }

  function waitForVideo(n) {
    n = n || 0;
    if (document.querySelector("video")) { start(); }
    else if (n < 40) setTimeout(() => waitForVideo(n + 1), 500);
    else console.warn("[DualSub] No video found.");
  }

  waitForVideo(0);
})();