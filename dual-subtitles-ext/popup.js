document.addEventListener('DOMContentLoaded', () => {
  const sourceEl = document.getElementById("sourceLang");
  const targetEl = document.getElementById("targetLang");
  const applyBtn = document.getElementById("applyBtn");
  const swapBtn  = document.getElementById("swapBtn");
  
  const sourceSizeSlider = document.getElementById("sourceFontSize");
  const targetSizeSlider = document.getElementById("targetFontSize");
  const sourceSizeVal = document.getElementById("sourceSizeVal");
  const targetSizeVal = document.getElementById("targetSizeVal");
  
  const posSlider = document.getElementById("subPosition");
  const posVal = document.getElementById("posVal");

  // Load saved settings
  chrome.storage.sync.get({ 
    sourceLang: "auto", 
    targetLang: "en",
    sourceFontSize: 28,
    targetFontSize: 20,
    subPosition: 0
  }, (s) => {
    sourceEl.value = s.sourceLang;
    targetEl.value = s.targetLang;
    
    sourceSizeSlider.value = s.sourceFontSize;
    sourceSizeVal.textContent = s.sourceFontSize + "px";
    
    targetSizeSlider.value = s.targetFontSize;
    targetSizeVal.textContent = s.targetFontSize + "px";

    posSlider.value = s.subPosition;
    posVal.textContent = (s.subPosition >= 0 ? "+" : "") + s.subPosition + "px";
  });

  swapBtn.addEventListener("click", () => {
    const srcVal = sourceEl.value;
    const tgtVal = targetEl.value;
    // Only swap if source is not "auto"
    if (srcVal !== "auto") {
      sourceEl.value = tgtVal;
      targetEl.value = srcVal;
    }
  });

  function sendLiveUpdate(msgObject) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msgObject);
    });
  }

  sourceSizeSlider.addEventListener("input", (e) => {
    const size = e.target.value;
    sourceSizeVal.textContent = size + "px";
    chrome.storage.sync.set({ sourceFontSize: parseInt(size, 10) });
    sendLiveUpdate({ type: "FONT_SIZE_UPDATED", fontType: "source", size: parseInt(size, 10) });
  });

  targetSizeSlider.addEventListener("input", (e) => {
    const size = e.target.value;
    targetSizeVal.textContent = size + "px";
    chrome.storage.sync.set({ targetFontSize: parseInt(size, 10) });
    sendLiveUpdate({ type: "FONT_SIZE_UPDATED", fontType: "target", size: parseInt(size, 10) });
  });

  posSlider.addEventListener("input", (e) => {
    const val = e.target.value;
    posVal.textContent = (val >= 0 ? "+" : "") + val + "px";
    chrome.storage.sync.set({ subPosition: parseInt(val, 10) });
    sendLiveUpdate({ type: "POSITION_UPDATED", subPosition: parseInt(val, 10) });
  });

  applyBtn.addEventListener("click", () => {
    const sourceLang = sourceEl.value;
    const targetLang = targetEl.value;
    chrome.storage.sync.set({ sourceLang, targetLang }, () => {
      sendLiveUpdate({ type: "SETTINGS_UPDATED", sourceLang, targetLang });
      applyBtn.textContent = "✓ Applied!";
      applyBtn.classList.add("saved");
      setTimeout(() => {
        applyBtn.textContent = "Apply Language Pair";
        applyBtn.classList.remove("saved");
      }, 2000);
    });
  });
});