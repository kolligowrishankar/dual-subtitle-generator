# 🎬 Dual Subtitle Generator

A Chrome extension that displays **German + English dual subtitles** on YouTube, Netflix, Amazon Prime, and any website with a video. No server required — works entirely in your browser.

## Features
- ✅ **YouTube** — auto-fetches German transcript, translates to English
- ✅ **Netflix** — reads German subtitles from player, adds English translation below
- ✅ **Amazon Prime** — same as Netflix
- ✅ **Any website** — detects subtitle text in DOM
- ✅ Word hover highlight — pause & hover a German word to see its English match
- ✅ Streaming translation — first subtitles appear in 2-3 seconds
- ✅ Gold overlay — beautiful readable design

## Installation (Local)

1. Download or clone this repo
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select this folder
5. Done — open any YouTube video in German!

## For Netflix & Amazon Prime
1. Start playing a German video
2. Open the subtitle/caption settings in the player
3. Select **German** subtitles
4. The extension automatically adds English translation below

## Publishing to Chrome Web Store

### Step 1 — Publish to GitHub
```bash
git init
git add .
git commit -m "Initial release"
git remote add origin https://github.com/YOUR_USERNAME/dual-subtitle-generator.git
git push -u origin main
```

### Step 2 — Package the extension
1. Go to `chrome://extensions`
2. Click **Pack extension**
3. Select your extension folder → click **Pack Extension**
4. This creates a `.crx` file and a `.pem` key file
5. **Keep the `.pem` file safe** — you need it for updates

### Step 3 — Publish to Chrome Web Store
1. Go to https://chrome.google.com/webstore/devconsole
2. Pay the one-time $5 developer fee
3. Click **Add new item** → upload the `.zip` of your extension folder
4. Fill in the store listing (description, screenshots)
5. Submit for review (takes 1-3 business days)

### Step 4 — Create a .zip for the store
```bash
# Windows PowerShell — run inside your extension folder:
Compress-Archive -Path * -DestinationPath dual-subtitle-generator.zip
```

## File Structure
```
extension/
├── manifest.json    — extension config
├── background.js    — fetches YouTube transcripts, handles translation
├── content.js       — injects overlay, reads Netflix/Prime DOM subtitles
├── popup.html       — extension toolbar popup
├── icon.png         — extension icon
└── README.md        — this file
```

## How translation works (no API key needed)
Uses Google Translate's free public endpoint (`translate.googleapis.com`). No signup, no key, no cost.

## Troubleshooting
| Problem | Fix |
|---------|-----|
| No subtitles on Netflix | Make sure German subtitles are enabled in the Netflix player |
| YouTube subtitles slow | Normal — first batch arrives in ~3s, rest stream in |
| Extension error banner | Click the extension icon → refresh the extension |