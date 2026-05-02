/**
 * background.js — service worker
 *
 * Fetches subtitle data from the local FastAPI server on behalf of
 * content scripts. Content scripts cannot reach 127.0.0.1 directly
 * (Chrome Private Network Access policy), but background service
 * workers can.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "FETCH_SUBTITLES") return false;

  const url = `http://127.0.0.1:8000/subtitles/${msg.videoId}`;
  console.log(`[DualSub BG] Fetching ${url}`);

  fetch(url)
    .then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error(`HTTP ${res.status}: ${t}`); });
      return res.json();
    })
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message }));

  return true; // keep message channel open for async response
});