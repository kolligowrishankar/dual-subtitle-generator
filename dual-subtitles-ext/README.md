# Dual Subtitle Generator

A Chrome extension that displays **German + English dual subtitles** side by side on YouTube, Netflix, Amazon Prime, and any website with a video. **No server required. No API key. No cost.**

---

##  Features

- **YouTube** — auto-fetches German transcript and translates to English in real time
- **Netflix** — reads German subtitles from the player, adds English translation below
- **Amazon Prime** — same as Netflix (enable German subtitles in the player first)
- **Any website** — detects subtitle text in the DOM automatically
- **Word hover** — pause the video and hover a German word to highlight its English match
- **Streaming** — first subtitles appear in 2–3 seconds, rest load in the background
- **Gold overlay** — 2.2rem German (gold) + 1.7rem English (white), readable on any background

---

##  Installation (Local / Developer Mode)

> No Python server needed. Everything runs inside Chrome.

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `dual-subtitles-ext` folder
6. The extension icon appears in your toolbar — you're done!

---

## How to Use

### YouTube
Just open any German YouTube video. The extension automatically:
- Detects the video ID
- Fetches the German transcript from YouTube
- Translates it to English in batches
- Displays the gold dual-subtitle overlay

### Netflix & Amazon Prime
1. Start playing a German video
2. Open the player's subtitle settings and select **German**
3. The extension reads the German subtitle text and adds English translation below automatically

### Other websites
The extension detects `<video>` elements and common subtitle containers on any site.

---

## File Structure

```
dual-subtitles-ext/
├── manifest.json     Chrome extension config (no server required)
├── background.js     Fetches YouTube transcripts + handles translation
├── content.js        Injects overlay, reads Netflix/Prime DOM subtitles
├── popup.html        Toolbar popup UI
├── icon16.png        Extension icon (16×16)
├── icon48.png        Extension icon (48×48)
├── icon128.png       Extension icon (128×128)
└── README.md         This file
```

---

##  Troubleshooting

| Problem | Solution |
|---|---|
| **No subtitles on YouTube** | Check that the video has German captions (CC button). Some videos have none. |
| **"Failed to fetch" error** | Refresh the YouTube page and wait 3 seconds |
| **No subtitles on Netflix** | Make sure German subtitles are enabled in the Netflix player first |
| **Subtitles appear late** | Normal — first batch loads in ~3s. Starts from wherever you are in the video. |
| **Extension won't load** | Make sure all 3 icon PNG files are in the folder |
| **"Service worker unavailable"** | Go to chrome://extensions → click the refresh icon on the extension |

---

##  Publishing to GitHub (already done)

My extension is live at:
**https://github.com/kolligowrishankar/dual-subtitle-generator**

### How to push future updates:

```powershell
# Run inside your dual-subtitles-ext folder
git add .
git commit -m "Describe your change here"
git pull --rebase origin main
git push
```

> ⚠️ Always run `git pull --rebase origin main` before `git push` to avoid the "fetch first" rejection error.

---

##  Why no Chrome Web Store?

Publishing to the Chrome Web Store requires a one-time $5 developer fee and a review process. For personal or educational use, loading directly from your local folder via Developer Mode works perfectly. Anyone who wants to use this extension can clone the GitHub repo and load it unpacked.

---

##  How translation works

Uses **Google Translate's free public endpoint** (`translate.googleapis.com`) — no API key, no account, no cost. Requests are made from the Chrome extension's background service worker, so there are no CORS issues.

---

##  License

MIT — free to use, modify, and share.
