/**
 * background.js — Dual Subtitle Generator
 * Handles translation with configurable source and target languages.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PING") { sendResponse({ pong: true }); return false; }

  if (msg.type === "TRANSLATE_BATCH") {
    const sl = msg.sourceLang || "auto";
    const tl = msg.targetLang || "en";
    translateBatch(msg.texts, sl, tl)
      .then(translated => sendResponse({ ok: true, translated }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

async function translateBatch(texts, sl, tl) {
  const results = [];
  for (const text of texts) {
    try {
      const url  = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
      const data = await (await fetch(url)).json();
      results.push(data[0].map(c => c[0]).join("") || text);
    } catch { results.push(text); }
  }
  return results;
}
