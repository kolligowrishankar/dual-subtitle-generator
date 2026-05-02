/**
 * content.js — Dual Subtitle Generator v3
 *
 * NEW STRATEGY: Read subtitles directly from the DOM on ALL platforms.
 * No HTTP fetching, no transcript API, no parsing needed.
 *
 * Platform subtitle selectors:
 *   YouTube  → .ytp-caption-segment
 *   Netflix  → .player-timedtext span, [data-uia="player-timedtext"] span
 *   Amazon   → .atvwebplayersdk-captions-text span, [class*="captions"] span
 *   Generic  → <track> elements, common subtitle class names
 *
 * Flow:
 *   1. Poll DOM every 100ms for subtitle text changes
 *   2. When text changes, send to background.js for translation (~150ms)
 *   3. Show German (original) + English (translated) in gold overlay
 *   4. Cache translations so same sentence is never translated twice
 */

(function () {
  "use strict";

  const POLL_MS  = 100;   // check for new subtitle text every 100ms
  const MAX_RETRY = 3;

  const host      = window.location.hostname;
  const isYouTube = host.includes("youtube.com");
  const isNetflix = host.includes("netflix.com");
  const isAmazon  = host.includes("amazon.") || host.includes("primevideo.com");

  let overlay     = null;
  let pollTimer   = null;
  let resizeTimer = null;
  let hoverActive = false;

  let lastGerman   = "";
  let lastEnglish  = "";
  let translating  = false;
  const cache      = new Map();   // german → english translation cache

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
      background:    "rgba(0,0,0,0.72)",
      display:       "none",
      maxWidth:      "88vw",
    });

    const deEl = document.createElement("div");
    deEl.id = "dual-sub-de";
    Object.assign(deEl.style, {
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize:   "28px", // Changed from rem to px for universal size
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
      fontSize:   "20px", // Changed from rem to px for universal size
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
    
    // Netflix needs 120px to clear its big UI, Amazon and YouTube sit lower
    const bottomOffset = isNetflix ? 120 : (isAmazon ? 60 : 70);
    
    overlay.style.bottom = (window.innerHeight - r.bottom + bottomOffset) + "px";
  }

  // ── Word hover highlight ──────────────────────────────────────────────────
  function renderWithHover(german, english) {
    const deEl = overlay.querySelector("#dual-sub-de");
    const enEl = overlay.querySelector("#dual-sub-en");
    const deTok = german.split(/(\s+)/);
    const enTok = english.split(/(\s+)/);
    const deWords = deTok.filter(w => w.trim());
    const enWords = enTok.filter(w => w.trim());

    deEl.innerHTML = "";
    let di = 0;
    deTok.forEach(tok => {
      if (!tok.trim()) { deEl.appendChild(document.createTextNode(tok)); return; }
      const span = document.createElement("span");
      span.textContent = tok;
      span.dataset.wi  = di;
      Object.assign(span.style, { cursor: "pointer", borderRadius: "3px" });
      span.addEventListener("mouseenter", () => {
        if (!isVideoPaused()) return;
        hoverActive = true;
        highlightEn(parseInt(span.dataset.wi), deWords.length, enWords.length, enEl, enTok);
        span.style.background = "rgba(255,215,0,0.3)";
        span.style.color = "#fff";
      });
      span.addEventListener("mouseleave", () => {
        hoverActive = false;
        span.style.background = "";
        span.style.color = "#FFD700";
        clearEnHighlight(enEl);
      });
      deEl.appendChild(span);
      di++;
    });

    renderEnPlain(enEl, enTok);
  }

  function renderEnPlain(enEl, tokens) {
    enEl.innerHTML = "";
    let i = 0;
    tokens.forEach(tok => {
      if (!tok.trim()) { enEl.appendChild(document.createTextNode(tok)); return; }
      const s = document.createElement("span");
      s.textContent = tok; s.dataset.wi = i++;
      enEl.appendChild(s);
    });
  }

  function highlightEn(di, dLen, eLen, enEl, enTok) {
    clearEnHighlight(enEl);
    if (!eLen || !dLen) return;
    const ratio = eLen / dLen;
    const eStart = Math.floor(di * ratio);
    const eEnd   = Math.min(eLen - 1, Math.floor((di + 1) * ratio));
    enEl.querySelectorAll("span").forEach(s => {
      if (+s.dataset.wi >= eStart && +s.dataset.wi <= eEnd)
        Object.assign(s.style, { background: "rgba(255,165,0,0.5)", color: "#FFE066", fontWeight: "700", borderRadius: "3px", padding: "0 2px" });
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

  function showCue(german, english) {
    if (!overlay) return;
    renderWithHover(german, english);
    overlay.style.display = "block";
    positionOverlay();
  }

  function hideCue() {
    if (!hoverActive && overlay) overlay.style.display = "none";
  }

  // ── Status banner ─────────────────────────────────────────────────────────
  function showStatus(msg, color, autohide) {
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
    if (autohide) setTimeout(() => { b.style.display = "none"; }, autohide);
  }

  // ── Video element ─────────────────────────────────────────────────────────
  function getVideoElement() {
    const all = Array.from(document.querySelectorAll("video"));
    return all.find(v => !v.paused && v.readyState >= 2)
        || all.find(v => v.readyState >= 2) || all[0] || null;
  }

  // ── DOM subtitle reader — platform-specific selectors ─────────────────────
  function readCurrentSubtitle() {
    let text = "";

    if (isYouTube) {
      // YouTube renders active captions into .ytp-caption-segment spans
      const segs = document.querySelectorAll(".ytp-caption-segment");
      text = Array.from(segs).map(e => e.textContent).join(" ").trim();
    }

    else if (isNetflix) {
      const els = document.querySelectorAll(
        ".player-timedtext-text-container span, " +
        ".nfp-player-timedtext span, " +
        "[data-uia='player-timedtext'] span"
      );
      text = Array.from(els).map(e => e.textContent).join(" ").trim();
    }

    else if (isAmazon) {
      const els = document.querySelectorAll(
        ".atvwebplayersdk-captions-text, " +
        "[class*='captions-text'] span, " +
        "[class*='TimedText'] span"
      );
      text = Array.from(els).map(e => e.textContent).join(" ").trim();
    }

    else {
      // Generic: try common subtitle container class names
      const els = document.querySelectorAll(
        ".vjs-text-track-display span, " +
        ".subtitle span, .subtitles span, " +
        "[class*='subtitle'] span, " +
        "[class*='caption'] span, " +
        ".caption-text, .sub-text"
      );
      text = Array.from(els).map(e => e.textContent).join(" ").trim();
    }

    // Collapse whitespace
    return text.replace(/\s+/g, " ").trim();
  }

  // ── Translation via background.js ─────────────────────────────────────────
  function translateAndShow(german) {
    // Check cache first — instant display for repeated lines
    if (cache.has(german)) {
      showCue(german, cache.get(german));
      return;
    }

    // Show German immediately while translation loads
    showCue(german, "…");
    translating = true;

    chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", texts: [german] }, (res) => {
      translating = false;
      if (res && res.ok && res.translated[0]) {
        const english = res.translated[0];
        cache.set(german, english);
        // Only update if this is still the current subtitle
        if (lastGerman === german) showCue(german, english);
      }
    });
  }

  // ── Poll loop ─────────────────────────────────────────────────────────────
  function tick() {
    positionOverlay();
    if (hoverActive) return;

    const german = readCurrentSubtitle();

    if (!german) {
      hideCue();
      lastGerman = "";
      return;
    }

    if (german === lastGerman) return;  // no change

    lastGerman = german;
    translateAndShow(german);
  }

  // ── Ping-retry helper ─────────────────────────────────────────────────────
  function pingThenSend(payload, cb, tries) {
    tries = tries === undefined ? MAX_RETRY : tries;
    chrome.runtime.sendMessage({ type: "PING" }, () => {
      if (chrome.runtime.lastError) {
        if (tries > 0) setTimeout(() => pingThenSend(payload, cb, tries - 1), 800);
        else cb({ ok: false, error: "Service worker unavailable" });
        return;
      }
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          if (tries > 0) setTimeout(() => pingThenSend(payload, cb, tries - 1), 800);
          else cb({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        cb(res || { ok: true });
      });
    });
  }

  // ── Auto-Enable & Hide Native Captions ────────────────────────────────────
  function autoEnableAndHideNativeCaptions() {
    // 1. Hide native text visually so they don't overlap, but keep them in DOM to read
    let style = document.getElementById("dual-sub-hide-native");
    if (!style) {
      style = document.createElement("style");
      style.id = "dual-sub-hide-native";
      style.textContent = `
        .caption-window { opacity: 0 !important; pointer-events: none !important; } /* YouTube */
        .player-timedtext { opacity: 0 !important; pointer-events: none !important; } /* Netflix */
        .atvwebplayersdk-captions-text { opacity: 0 !important; pointer-events: none !important; } /* Amazon */
      `;
      document.head.appendChild(style);
    }

    // 2. Auto-click the YouTube CC button if it is currently OFF
    if (isYouTube) {
      const ccBtn = document.querySelector('.ytp-subtitles-button');
      if (ccBtn && ccBtn.getAttribute('aria-pressed') === 'false') {
        ccBtn.click();
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function start() {
    createOverlay();
    autoEnableAndHideNativeCaptions(); // Hides native text and clicks CC automatically

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(tick, POLL_MS);

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer); resizeTimer = setTimeout(positionOverlay, 100);
    });

    // Handle moving the overlay when entering/exiting Full Screen
    document.addEventListener("fullscreenchange", () => {
      if (overlay) {
        const fsElement = document.fullscreenElement;
        if (fsElement) {
          // Move our overlay inside the full-screen element so it stays on top
          fsElement.appendChild(overlay);
        } else {
          // Move it back to the normal body when we exit full-screen
          document.body.appendChild(overlay);
        }
      }
      setTimeout(positionOverlay, 200);
    });

    const platform = isYouTube ? "YouTube" : isNetflix ? "Netflix" : isAmazon ? "Prime Video" : "Generic";
    showStatus(`✅ DualSub active — ${platform} mode`, "rgba(0,120,60,0.9)", 4000);
    console.log(`[DualSub] Started in ${platform} mode`);
  }

  function waitForVideo(n) {
    n = n || 0;
    if (document.querySelector("video")) { start(); }
    else if (n < 40) setTimeout(() => waitForVideo(n + 1), 500);
    else console.warn("[DualSub] No video found.");
  }

  waitForVideo(0);
})();