/**
 * background.js — service worker (subtitles-backend companion)
 *
 * Fetches subtitle data from the local FastAPI server on behalf of
 * content scripts, forwarding language parameters.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "FETCH_SUBTITLES") return false;

  const sourceLang = msg.sourceLang || "auto";
  const targetLang = msg.targetLang || "en";
  const url = `http://127.0.0.1:8000/subtitles/${msg.videoId}?source_lang=${sourceLang}&target_lang=${targetLang}`;

  console.log(`[DualSub BG] Fetching ${url}`);

  fetch(url)
    .then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error(`HTTP ${res.status}: ${t}`); });
      return res.json();
    })
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message }));

  return true;
});
