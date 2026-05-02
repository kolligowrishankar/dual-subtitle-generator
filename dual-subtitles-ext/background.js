/**
 * background.js — Dual Subtitle Generator v2
 *
 * Architecture (fully serverless — no Python needed):
 *
 * For YOUTUBE videos:
 *   Fetches transcript from youtube-transcript-api via a free public proxy
 *   (or falls back to scraping the timedtext endpoint directly).
 *
 * For NETFLIX / AMAZON PRIME / ANY SITE:
 *   The content script extracts subtitles directly from the page DOM
 *   (Netflix/Prime render subtitle text into DOM elements).
 *   Background just handles translation via Google Translate's free endpoint.
 *
 * Translation: Uses Google Translate's free web endpoint (no API key needed).
 */

const BATCH_SIZE = 15;

// ── Message router ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PING") { sendResponse({ pong: true }); return false; }

  if (msg.type === "TRANSLATE_BATCH") {
    translateBatch(msg.texts)
      .then(translated => sendResponse({ ok: true, translated }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
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
      const res = await fetch(url);
      const data = await res.json();
      // Response format: [[[translated, original, ...], ...], ...]
      const translation = data[0].map(chunk => chunk[0]).join("");
      results.push(translation || text);
    } catch {
      results.push(text); // fallback to original
    }
  }
  return results;
}

// ── YouTube transcript fetcher ────────────────────────────────────────────
async function fetchYouTubeTranscript(videoId, tabId) {
  try {
    // Step 1: get the video page to find timedtext URL
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "Accept-Language": "en-US,en;q=0.9" }
    });
    const html = await pageRes.text();

    // Extract caption tracks JSON from page source
    const match = html.match(/"captionTracks":(\[.*?\])/);
    if (!match) {
      // Try alternative: check if captions exist at all
      sendStreamMsg(tabId, { type: "error", error: "No captions found for this video." });
      return;
    }

    const tracks = JSON.parse(match[1]);

    // Prefer manual German, then any German, then first available
    let track = tracks.find(t => t.languageCode === "de" && !t.kind);
    if (!track) track = tracks.find(t => t.languageCode === "de");
    if (!track) track = tracks.find(t => t.languageCode?.startsWith("de"));
    if (!track) track = tracks[0];

    if (!track) {
      sendStreamMsg(tabId, { type: "error", error: "No German captions available." });
      return;
    }

    const isManual = !track.kind; // kind = "asr" means auto-generated
    const transcriptUrl = track.baseUrl + "&fmt=json3";

    const transcriptRes = await fetch(transcriptUrl);
    const transcriptData = await transcriptRes.json();

    const events = transcriptData.events || [];

    // Flatten to cue array
    const rawCues = [];
    for (const event of events) {
      if (!event.segs) continue;
      const text = event.segs.map(s => s.utf8).join("").replace(/\n/g, " ").trim();
      if (!text) continue;
      const startMs = event.tStartMs || 0;
      const durMs   = event.dDurationMs || 2000;
      const offset  = isManual ? 0 : 1500; // auto-gen drift compensation
      rawCues.push({
        start:  Math.max(0, (startMs - offset) / 1000),
        end:    Math.max(0, (startMs + durMs - offset) / 1000),
        german: text,
      });
    }

    sendStreamMsg(tabId, {
      type:   "header",
      manual: isManual,
      total:  rawCues.length,
    });

    // Translate in batches and stream
    for (let i = 0; i < rawCues.length; i += BATCH_SIZE) {
      const batch   = rawCues.slice(i, i + BATCH_SIZE);
      const texts   = batch.map(c => c.german);
      const translated = await translateBatch(texts);

      const cues = batch.map((c, j) => ({
        ...c,
        english: translated[j] || c.german,
      }));

      sendStreamMsg(tabId, { type: "batch", cues });
    }

    sendStreamMsg(tabId, { type: "done", total: rawCues.length });

  } catch (err) {
    sendStreamMsg(tabId, { type: "error", error: err.message });
  }
}

function sendStreamMsg(tabId, payload) {
  chrome.tabs.sendMessage(tabId, { type: "SUB_STREAM", payload }).catch(() => {});
}