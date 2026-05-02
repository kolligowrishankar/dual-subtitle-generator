/**
 * background.js — Dual Subtitle Generator v3
 * Much simpler now — only handles translation.
 * Subtitle reading is done by content.js directly from the DOM.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PING") { sendResponse({ pong: true }); return false; }

  if (msg.type === "TRANSLATE_BATCH") {
    translateBatch(msg.texts)
      .then(translated => sendResponse({ ok: true, translated }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

async function translateBatch(texts) {
  const results = [];
  for (const text of texts) {
    try {
      const url  = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=en&dt=t&q=${encodeURIComponent(text)}`;
      const data = await (await fetch(url)).json();
      results.push(data[0].map(c => c[0]).join("") || text);
    } catch { results.push(text); }
  }
  return results;
}
