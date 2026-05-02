/**
 * background.js — Dual Subtitle Generator v2.3
 * Fix: XML regex was too strict — srv3 format uses different tag structure
 * Now tries multiple XML patterns + falls back to plain timedtext API
 */

const BATCH_SIZE = 15;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PING") { sendResponse({ pong: true }); return false; }

  if (msg.type === "TRANSLATE_BATCH") {
    translateBatch(msg.texts)
      .then(t => sendResponse({ ok: true, translated: t }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "FETCH_YOUTUBE_TRANSCRIPT") {
    fetchYouTubeTranscript(msg.videoId, sender.tab.id);
    sendResponse({ ok: true, streaming: true });
    return true;
  }
  return false;
});

// ── Google Translate free endpoint ────────────────────────────────────────
async function translateBatch(texts) {
  const results = [];
  for (const text of texts) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=en&dt=t&q=${encodeURIComponent(text)}`;
      const data = await (await fetch(url)).json();
      results.push(data[0].map(c => c[0]).join("") || text);
    } catch { results.push(text); }
  }
  return results;
}

// ── Main transcript fetcher ───────────────────────────────────────────────
async function fetchYouTubeTranscript(videoId, tabId) {
  try {
    // ── Strategy 1: scrape captionTracks from the YouTube page ──
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      credentials: "include",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      }
    });
    const html = await pageRes.text();

    let tracks = extractTracksFromHTML(html);

    // ── Strategy 2: timedtext list API ──
    if (!tracks || !tracks.length) {
      tracks = await fetchTracksViaListAPI(videoId);
    }

    if (!tracks || !tracks.length) {
      sendMsg(tabId, { type: "error", error: "No captions found for this video." });
      return;
    }

    // Pick best German track
    const track =
      tracks.find(t => t.languageCode === "de"          && t.kind !== "asr") ||
      tracks.find(t => t.languageCode?.startsWith("de") && t.kind !== "asr") ||
      tracks.find(t => t.languageCode === "de") ||
      tracks.find(t => t.languageCode?.startsWith("de")) ||
      tracks[0];

    const isManual = track.kind !== "asr";
    const driftMs  = isManual ? 0 : 1200;

    console.log("[DualSub] Using track:", track.languageCode, "manual:", isManual);

    // ── Fetch transcript — try 3 URL formats in order ──
    const cues = await fetchCuesWithFallbacks(track, videoId, driftMs);

    if (!cues || cues.length === 0) {
      sendMsg(tabId, { type: "error", error: "Transcript was empty. This video may have no German captions." });
      return;
    }

    sendMsg(tabId, { type: "header", manual: isManual, total: cues.length });

    for (let i = 0; i < cues.length; i += BATCH_SIZE) {
      const batch      = cues.slice(i, i + BATCH_SIZE);
      const translated = await translateBatch(batch.map(c => c.german));
      sendMsg(tabId, {
        type: "batch",
        cues: batch.map((c, j) => ({ ...c, english: translated[j] || c.german }))
      });
    }

    sendMsg(tabId, { type: "done", total: cues.length });

  } catch (err) {
    console.error("[DualSub BG]", err);
    sendMsg(tabId, { type: "error", error: err.message });
  }
}

// ── Extract tracks from HTML ──────────────────────────────────────────────
function extractTracksFromHTML(html) {
  // Try playerResponse JSON blob first (most reliable)
  const prMatch = html.match(/"playerCaptionsTracklistRenderer":\{"captionTracks":(\[[\s\S]*?\])/);
  if (prMatch) {
    try { return JSON.parse(prMatch[1]); } catch {}
  }
  // Try simpler captionTracks match
  const m = html.match(/"captionTracks":(\[[\s\S]*?\]),"/);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  return null;
}

// ── Fallback: timedtext list API ──────────────────────────────────────────
async function fetchTracksViaListAPI(videoId) {
  try {
    const xml = await (await fetch(
      `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`,
      { credentials: "include" }
    )).text();

    const tracks = [];
    const re = /<track[^>]+lang_code="([^"]*)"[^>]*name="([^"]*)"[^>]*>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      tracks.push({
        languageCode: m[1],
        language:     m[2],
        kind:         "manual",
        baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${m[1]}&name=${encodeURIComponent(m[2])}`,
      });
    }
    return tracks;
  } catch { return null; }
}

// ── Fetch cues trying multiple URL formats ────────────────────────────────
async function fetchCuesWithFallbacks(track, videoId, driftMs) {
  const baseUrl = track.baseUrl || "";

  // Build candidate URLs to try
  const urls = [
    // Plain URL with no format override (often works best)
    baseUrl.replace(/&fmt=[^&]*/g, ""),
    // JSON3 format
    baseUrl.replace(/&fmt=[^&]*/g, "") + "&fmt=json3",
    // XML format via timedtext API directly
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${track.languageCode}&fmt=srv3`,
    // Bare timedtext
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${track.languageCode}`,
  ];

  for (const url of urls) {
    try {
      console.log("[DualSub] Trying URL:", url.slice(0, 80));
      const res  = await fetch(url, { credentials: "include" });
      if (!res.ok) continue;

      const text = await res.text();
      if (!text || text.length < 20) continue;

      // Try JSON parse first
      if (text.trim().startsWith("{")) {
        const cues = parseJSON3(text, driftMs);
        if (cues.length > 0) { console.log("[DualSub] Parsed JSON3:", cues.length, "cues"); return cues; }
      }

      // Try XML parse
      const cues = parseXML(text, driftMs);
      if (cues.length > 0) { console.log("[DualSub] Parsed XML:", cues.length, "cues"); return cues; }

    } catch (e) { console.warn("[DualSub] URL failed:", e.message); }
  }

  return [];
}

// ── JSON3 parser ──────────────────────────────────────────────────────────
function parseJSON3(text, driftMs) {
  try {
    const data   = JSON.parse(text);
    const events = data.events || [];
    const cues   = [];
    for (const ev of events) {
      if (!ev.segs) continue;
      const raw = ev.segs.map(s => s.utf8 || "").join("").replace(/\n/g, " ").trim();
      if (!raw) continue;
      cues.push({
        start:  Math.max(0, ((ev.tStartMs  || 0) - driftMs) / 1000),
        end:    Math.max(0, ((ev.tStartMs  || 0) + (ev.dDurationMs || 2000) - driftMs) / 1000),
        german: raw,
      });
    }
    return cues;
  } catch { return []; }
}

// ── XML parser — handles both <text> and <p> tags ─────────────────────────
function parseXML(xml, driftMs) {
  const cues = [];
  const decode = s => s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n/g, " ").trim();

  // Format 1: <text start="1.23" dur="2.00">...</text>  (classic timedtext)
  let re = /<text[^>]+start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const raw = decode(m[3]);
    if (!raw) continue;
    const start = parseFloat(m[1]);
    const dur   = parseFloat(m[2]);
    cues.push({ start: Math.max(0, start - driftMs/1000), end: Math.max(0, start + dur - driftMs/1000), german: raw });
  }
  if (cues.length > 0) return cues;

  // Format 2: <p t="1230" d="2000">...</p>  (srv3 timedtext)
  re = /<p[^>]+\bt="(\d+)"[^>]*\bd="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  while ((m = re.exec(xml)) !== null) {
    const raw = decode(m[3]);
    if (!raw) continue;
    const startMs = parseInt(m[1]), durMs = parseInt(m[2]);
    cues.push({
      start:  Math.max(0, (startMs - driftMs) / 1000),
      end:    Math.max(0, (startMs + durMs - driftMs) / 1000),
      german: raw,
    });
  }
  return cues;
}

function sendMsg(tabId, payload) {
  chrome.tabs.sendMessage(tabId, { type: "SUB_STREAM", payload }).catch(() => {});
}
