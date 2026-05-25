/**
 * content.js — Dual Subtitle Generator
 *
 * Supports configurable languages, font sizes, and vertical positioning.
 * Includes SPA navigation support and robust context invalidation handling.
 */

(function () {
  "use strict";

  const POLL_MS   = 100;
  
  const host      = window.location.hostname;
  const isYouTube = host.includes("youtube.com");
  const isNetflix = host.includes("netflix.com");
  const isAmazon  = host.includes("amazon.") || host.includes("primevideo.com");

  let overlay     = null;
  let pollTimer   = null;
  let resizeTimer = null;
  let hoverActive = false;

  let lastOriginal = "";
  let lastTranslated = "";
  let translating  = false;
  const cache      = new Map();
  const wordCache  = new Map();

  // Settings — loaded from storage, hot-reloadable
  let sourceLang = "auto";
  let targetLang = "en";
  let sourceFontSize = 28; 
  let targetFontSize = 20; 
  let subPosition = 0; 

  // ── Load language settings ────────────────────────────────────────────────
  function loadSettings(cb) {
    try {
      chrome.storage.sync.get({ 
        sourceLang: "auto", 
        targetLang: "en", 
        sourceFontSize: 28, 
        targetFontSize: 20,
        subPosition: 0 
      }, (s) => {
        if (chrome.runtime.lastError) return;
        sourceLang = s.sourceLang;
        targetLang = s.targetLang;
        sourceFontSize = s.sourceFontSize;
        targetFontSize = s.targetFontSize;
        subPosition = s.subPosition;
        if (cb) cb();
      });
    } catch (e) {
      console.warn("[DualSub] Context invalidated during load.");
    }
  }

  // Listen for live updates from the popup
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SETTINGS_UPDATED") {
        sourceLang = msg.sourceLang;
        targetLang = msg.targetLang;
        cache.clear();
        wordCache.clear();
        lastOriginal = "";
        lastTranslated = "";
        const langLabel = `${msg.sourceLang.toUpperCase()} → ${msg.targetLang.toUpperCase()}`;
        showStatus(`🌐 DualSub: ${langLabel}`, "rgba(0,80,160,0.9)", 3000);
      } 
      else if (msg.type === "FONT_SIZE_UPDATED") {
        if (msg.fontType === "source") {
          sourceFontSize = msg.size;
          const srcEl = document.getElementById("dual-sub-src");
          if (srcEl) srcEl.style.fontSize = sourceFontSize + "px";
        } else if (msg.fontType === "target") {
          targetFontSize = msg.size;
          const tgtEl = document.getElementById("dual-sub-tgt");
          if (tgtEl) tgtEl.style.fontSize = targetFontSize + "px";
        }
        positionOverlay();
      }
      else if (msg.type === "POSITION_UPDATED") {
        subPosition = msg.subPosition;
        positionOverlay();
      }
    });
  } catch (e) {
    // Ignore if context is already invalidated
  }

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
      pointerEvents: "none",
      padding:       "10px 24px",
      borderRadius:  "8px",
      background:    "transparent", 
      display:       "none",
      maxWidth:      "88vw",
    });

    const srcEl = document.createElement("div");
    srcEl.id = "dual-sub-src";
    Object.assign(srcEl.style, {
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize:   sourceFontSize + "px",
      fontWeight: "700",
      color:      "#FFD700",
      lineHeight: "1.4",
      textShadow: "2px 2px 4px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000, 1px 1px 2px #000",
      whiteSpace: "pre-wrap",
      wordBreak:  "break-word",
      cursor:     "default",
    });

    const tgtEl = document.createElement("div");
    tgtEl.id = "dual-sub-tgt";
    Object.assign(tgtEl.style, {
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize:   targetFontSize + "px",
      fontWeight: "400",
      color:      "#FFFFFF",
      lineHeight: "1.4",
      textShadow: "2px 2px 4px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000, 1px 1px 2px #000",
      marginTop:  "4px",
      whiteSpace: "pre-wrap",
      wordBreak:  "break-word",
    });

    overlay.appendChild(srcEl);
    overlay.appendChild(tgtEl);
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
    
    const baseBottomOffset = isNetflix ? 120 : (isAmazon ? 60 : 70);
    const finalOffset = baseBottomOffset + subPosition;
    
    overlay.style.bottom = (window.innerHeight - r.bottom + finalOffset) + "px";
  }

  // ── Word hover ────────────────────────────────────────────────────────────
  function renderWithHover(original, translated) {
    const srcEl = overlay.querySelector("#dual-sub-src");
    const tgtEl = overlay.querySelector("#dual-sub-tgt");

    const tokens = original.split(/(\s+)/);

    srcEl.innerHTML = "";
    tokens.forEach(tok => {
      if (!tok.trim()) { srcEl.appendChild(document.createTextNode(tok)); return; }

      const span = document.createElement("span");
      span.textContent = tok;
      span.dataset.word = tok;
      Object.assign(span.style, {
        cursor:        "pointer",
        borderRadius:  "3px",
        transition:    "background 0.12s",
        pointerEvents: "auto",
      });

      span.addEventListener("mouseenter", () => {
        if (!isVideoPaused()) return;
        hoverActive = true;
        span.style.background = "rgba(255,215,0,0.35)";
        span.style.color      = "#fff";
        showWordTranslation(tok, tgtEl, translated);
      });

      span.addEventListener("mouseleave", () => {
        hoverActive = false;
        span.style.background = "";
        span.style.color      = "#FFD700";
        tgtEl.textContent = translated;
        Object.assign(tgtEl.style, { color: "#fff", fontSize: targetFontSize + "px" });
      });

      srcEl.appendChild(span);
    });

    tgtEl.textContent = translated;
    Object.assign(tgtEl.style, { color: "#fff", fontSize: targetFontSize + "px" });
  }

  function cleanWord(w) {
    return w.replace(/^\P{L}+|\P{L}+$/gu, "");
  }

  function showWordTranslation(word, tgtEl, fullTranslated) {
    const clean = cleanWord(word);
    if (!clean) return;

    const cacheKey = `${clean.toLowerCase()}__${sourceLang}__${targetLang}`;
    if (wordCache.has(cacheKey)) {
      renderWordResult(tgtEl, word, wordCache.get(cacheKey), fullTranslated);
      return;
    }

    tgtEl.textContent = `${word} = …`;
    Object.assign(tgtEl.style, { color: "#FFD700", fontSize: "18px" });

    // SAFETY NET: Try...Catch block to prevent extension invalidation crashes
    try {
      chrome.runtime.sendMessage(
        { type: "TRANSLATE_BATCH", texts: [clean], sourceLang, targetLang },
        res => {
          if (chrome.runtime.lastError) return; // Fail silently if connection drops
          
          if (res?.ok && res.translated[0]) {
            const result = res.translated[0];
            wordCache.set(cacheKey, result);
            if (hoverActive) renderWordResult(tgtEl, word, result, fullTranslated);
          }
        }
      );
    } catch (e) {
      if (e.message.includes("Extension context invalidated")) {
        clearInterval(pollTimer);
        console.warn("[DualSub] Extension updated. Please refresh the page.");
      }
    }
  }

  function renderWordResult(tgtEl, word, translation, fullTranslated) {
    tgtEl.innerHTML = "";

    const wSpan = document.createElement("span");
    wSpan.textContent = cleanWord(word);
    Object.assign(wSpan.style, { color: "#FFD700", fontWeight: "700" });

    const eq = document.createTextNode(" = ");

    const tSpan = document.createElement("span");
    tSpan.textContent = translation;
    Object.assign(tSpan.style, {
      color:        "#FFE066",
      fontWeight:   "700",
      background:   "rgba(255,165,0,0.4)",
      borderRadius: "4px",
      padding:      "0 6px",
    });

    tgtEl.appendChild(wSpan);
    tgtEl.appendChild(eq);
    tgtEl.appendChild(tSpan);
    Object.assign(tgtEl.style, { fontSize: targetFontSize + "px" });
  }

  function isVideoPaused() {
    const v = getVideoElement(); return v ? v.paused : true;
  }

  function showCue(original, translated) {
    if (!overlay) return;
    renderWithHover(original, translated);
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

  // ── DOM subtitle reader ───────────────────────────────────────────────────
  function readCurrentSubtitle() {
    let text = "";

    if (isYouTube) {
      const segs = document.querySelectorAll(".ytp-caption-segment");
      text = Array.from(segs).map(e => e.textContent).join(" ").trim();
    } else if (isNetflix) {
      const container = document.querySelector(
        ".player-timedtext-text-container, " +
        ".nfp-player-timedtext, " +
        "[data-uia='player-timedtext']"
      );
      if (container) text = container.textContent;
    } else if (isAmazon) {
      const container = document.querySelector(
        ".atvwebplayersdk-captions-text, " +
        "[class*='captions-text'], " +
        "[class*='TimedText']"
      );
      if (container) text = container.textContent;
    } else {
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

  // ── Translation ───────────────────────────────────────────────────────────
  function translateAndShow(original) {
    const cacheKey = `${original}__${sourceLang}__${targetLang}`;
    if (cache.has(cacheKey)) {
      showCue(original, cache.get(cacheKey));
      return;
    }

    showCue(original, "…");
    translating = true;

    // SAFETY NET: Try...Catch block to prevent extension invalidation crashes
    try {
      chrome.runtime.sendMessage(
        { type: "TRANSLATE_BATCH", texts: [original], sourceLang, targetLang },
        (res) => {
          if (chrome.runtime.lastError) {
            translating = false;
            return; // Fail silently if connection drops
          }
          
          translating = false;
          if (res && res.ok && res.translated[0]) {
            const translated = res.translated[0];
            cache.set(cacheKey, translated);
            if (lastOriginal === original) showCue(original, translated);
          }
        }
      );
    } catch (e) {
      if (e.message.includes("Extension context invalidated")) {
        clearInterval(pollTimer);
        if (overlay) overlay.style.display = "none";
        console.warn("[DualSub] Extension updated. Please refresh the page.");
      }
    }
  }

  // ── Poll loop ─────────────────────────────────────────────────────────────
  function tick() {
    positionOverlay();
    if (hoverActive) return;

    const original = readCurrentSubtitle();

    if (!original) {
      hideCue();
      lastOriginal = "";
      return;
    }

    if (original === lastOriginal) return;

    lastOriginal = original;
    translateAndShow(original);
  }

  // ── Auto-hide native captions ─────────────────────────────────────────────
  function autoEnableAndHideNativeCaptions() {
    let style = document.getElementById("dual-sub-hide-native");
    if (!style) {
      style = document.createElement("style");
      style.id = "dual-sub-hide-native";
      style.textContent = `
        .caption-window { opacity: 0 !important; pointer-events: none !important; }
        .player-timedtext { opacity: 0 !important; pointer-events: none !important; }
        .atvwebplayersdk-captions-text { opacity: 0 !important; pointer-events: none !important; }
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
        if (fsElement) fsElement.appendChild(overlay);
        else document.body.appendChild(overlay);
      }
      setTimeout(positionOverlay, 200);
    });

    const platform = isYouTube ? "YouTube" : isNetflix ? "Netflix" : isAmazon ? "Prime Video" : "Generic";
    const langLabel = `${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()}`;
    showStatus(`✅ DualSub active — ${platform} · ${langLabel}`, "rgba(0,120,60,0.9)", 4000);
    console.log(`[DualSub] Started in ${platform} mode (${langLabel})`);
  }

  // SPA Fix: Wait for video to appear in DOM without timing out
  function waitForVideo() {
    if (document.querySelector("video")) {
      start();
    } else {
      const observer = new MutationObserver((mutations, obs) => {
        if (document.querySelector("video")) {
          obs.disconnect(); 
          start();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Load settings first, then boot
  loadSettings(() => waitForVideo());
})();