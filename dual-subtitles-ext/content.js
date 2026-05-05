/**
 * content.js — Dual Subtitle Generator v4
 *
 * Fixed: Pointer-events blocking video timeline controls.
 * Fixed: Amazon Prime duplicate text selection.
 */

(function () {
  "use strict";

  const POLL_MS  = 100;   
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
  const cache      = new Map();   
  const wordCache  = new Map();

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
      // FIX: Set to 'none' so clicks pass through to the Netflix/Prime timeline!
      pointerEvents: "none", 
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
      fontSize:   "28px", 
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
      fontSize:   "20px", 
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
    
    const bottomOffset = isNetflix ? 120 : (isAmazon ? 60 : 70);
    overlay.style.bottom = (window.innerHeight - r.bottom + bottomOffset) + "px";
  }

  // ── Word hover — direct per-word translation ──────────────────────────────
  function renderWithHover(german, english) {
    const deEl = overlay.querySelector("#dual-sub-de");
    const enEl = overlay.querySelector("#dual-sub-en");

    const deTok = german.split(/(\s+)/);

    deEl.innerHTML = "";
    deTok.forEach(tok => {
      if (!tok.trim()) { deEl.appendChild(document.createTextNode(tok)); return; }

      const span = document.createElement("span");
      span.textContent = tok;
      span.dataset.word = tok;
      Object.assign(span.style, {
        cursor:       "pointer",
        borderRadius: "3px",
        transition:   "background 0.12s",
        // FIX: Set words back to 'auto' so the hover feature still works!
        pointerEvents: "auto", 
      });

      span.addEventListener("mouseenter", () => {
        if (!isVideoPaused()) return;
        hoverActive = true;
        span.style.background = "rgba(255,215,0,0.35)";
        span.style.color      = "#fff";
        showWordTranslation(tok, enEl, english);
      });

      span.addEventListener("mouseleave", () => {
        hoverActive = false;
        span.style.background = "";
        span.style.color      = "#FFD700";
        enEl.textContent = english;
        Object.assign(enEl.style, { color: "#fff", fontSize: "20px" });
      });

      deEl.appendChild(span);
    });

    enEl.textContent = english;
    Object.assign(enEl.style, { color: "#fff", fontSize: "20px" });
  }

  function cleanWord(w) {
    return w.replace(/^[^a-zA-ZäöüÄÖÜß]+|[^a-zA-ZäöüÄÖÜß]+$/g, "");
  }

  function showWordTranslation(word, enEl, fullEnglish) {
    const clean = cleanWord(word);
    if (!clean) return;

    if (wordCache.has(clean.toLowerCase())) {
      renderWordResult(enEl, word, wordCache.get(clean.toLowerCase()), fullEnglish);
      return;
    }

    enEl.textContent = `${word} = …`;
    Object.assign(enEl.style, { color: "#FFD700", fontSize: "18px" });

    chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", texts: [clean] }, res => {
      if (res?.ok && res.translated[0]) {
        const result = res.translated[0];
        wordCache.set(clean.toLowerCase(), result);
        if (hoverActive) renderWordResult(enEl, word, result, fullEnglish);
      }
    });
  }

  function renderWordResult(enEl, word, translation, fullEnglish) {
    enEl.innerHTML = "";

    const wSpan = document.createElement("span");
    wSpan.textContent = cleanWord(word);
    Object.assign(wSpan.style, { color: "#FFD700", fontWeight: "700" });

    const eq = document.createTextNode(" = ");

    const tSpan = document.createElement("span");
    tSpan.textContent = translation;
    Object.assign(tSpan.style, {
      color:          "#FFE066",
      fontWeight:     "700",
      background:     "rgba(255,165,0,0.4)",
      borderRadius:   "4px",
      padding:        "0 6px",
    });

    enEl.appendChild(wSpan);
    enEl.appendChild(eq);
    enEl.appendChild(tSpan);
    Object.assign(enEl.style, { fontSize: "20px" });
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

  function getVideoElement() {
    const all = Array.from(document.querySelectorAll("video"));
    return all.find(v => !v.paused && v.readyState >= 2)
        || all.find(v => v.readyState >= 2) || all[0] || null;
  }

  // ── DOM subtitle reader — platform-specific selectors ─────────────────────
  function readCurrentSubtitle() {
    let text = "";

    if (isYouTube) {
      const segs = document.querySelectorAll(".ytp-caption-segment");
      text = Array.from(segs).map(e => e.textContent).join(" ").trim();
    }

    else if (isNetflix) {
      const container = document.querySelector(
        ".player-timedtext-text-container, " +
        ".nfp-player-timedtext, " +
        "[data-uia='player-timedtext']"
      );
      if (container) {
        text = container.textContent;
      }
    }

    else if (isAmazon) {
      // FIX: Brute force querySelector just like Netflix. 
      // Only grabs the main box, ignoring duplicate child spans.
      const container = document.querySelector(
        ".atvwebplayersdk-captions-text, " +
        "[class*='captions-text'], " +
        "[class*='TimedText']"
      );
      if (container) {
        text = container.textContent;
      }
    }

    else {
      const els = document.querySelectorAll(
        ".vjs-text-track-display span, " +
        ".subtitle span, .subtitles span, " +
        "[class*='subtitle'] span, " +
        "[class*='caption'] span, " +
        ".caption-text, .sub-text"
      );
      text = Array.from(els).map(e => e.textContent).join(" ").trim();
    }

    return text.replace(/\s+/g, " ").trim();
  }

  // ── Translation via background.js ─────────────────────────────────────────
  function translateAndShow(german) {
    if (cache.has(german)) {
      showCue(german, cache.get(german));
      return;
    }

    showCue(german, "…");
    translating = true;

    chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", texts: [german] }, (res) => {
      translating = false;
      if (res && res.ok && res.translated[0]) {
        const english = res.translated[0];
        cache.set(german, english);
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

    if (german === lastGerman) return; 

    lastGerman = german;
    translateAndShow(german);
  }

  // ── Auto-Enable & Hide Native Captions ────────────────────────────────────
  function autoEnableAndHideNativeCaptions() {
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
    autoEnableAndHideNativeCaptions();

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(tick, POLL_MS);

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer); resizeTimer = setTimeout(positionOverlay, 100);
    });

    document.addEventListener("fullscreenchange", () => {
      if (overlay) {
        const fsElement = document.fullscreenElement;
        if (fsElement) {
          fsElement.appendChild(overlay);
        } else {
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