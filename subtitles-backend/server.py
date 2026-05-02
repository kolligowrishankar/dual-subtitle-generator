"""
Dual Subtitle Generator - server.py v3

Key improvement: STREAMING batch translation.
Instead of translating all cues then returning, we translate in batches
of 20 and stream each batch immediately. The frontend gets the first
subtitles within 2-3 seconds and the rest fill in as translation continues.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from youtube_transcript_api import YouTubeTranscriptApi
from deep_translator import GoogleTranslator
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Dual Subtitle Generator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

translator = GoogleTranslator(source="auto", target="en")

DEFAULT_AUTO_OFFSET = 1.5
BATCH_SIZE = 20  # cues per streamed batch — first batch arrives in ~2s


def get_best_transcript(video_id: str):
    api = YouTubeTranscriptApi()
    all_transcripts = list(api.list(video_id))

    logger.info("Available transcripts:")
    for t in all_transcripts:
        logger.info(f"  lang={t.language_code!r}  auto={t.is_generated}  name={t.language!r}")

    for t in all_transcripts:
        if t.language_code == "de" and not t.is_generated:
            logger.info("✅ Manual German (de)")
            return t.fetch(), True
    for t in all_transcripts:
        if t.language_code.startswith("de") and not t.is_generated:
            logger.info(f"✅ Manual German ({t.language_code})")
            return t.fetch(), True
    for t in all_transcripts:
        if not t.is_generated:
            logger.warning(f"⚠ Manual non-German ({t.language_code})")
            return t.fetch(), True
    for t in all_transcripts:
        if t.language_code == "de" and t.is_generated:
            logger.warning("⚠ Auto-generated German")
            return t.fetch(), False
    for t in all_transcripts:
        if t.is_generated:
            logger.warning(f"⚠ Auto-generated {t.language_code}")
            return t.fetch(), False

    raise HTTPException(status_code=404, detail=f"No transcripts found for '{video_id}'")


def stream_subtitles(video_id: str, offset: float):
    """
    Generator that yields newline-delimited JSON batches.
    First message: metadata header.
    Subsequent messages: arrays of translated cue objects.
    """
    try:
        raw, is_manual = get_best_transcript(video_id)
    except HTTPException as e:
        yield json.dumps({"error": e.detail}) + "\n"
        return
    except Exception as e:
        yield json.dumps({"error": str(e)}) + "\n"
        return

    time_offset = 0.0 if is_manual else offset

    # Send header first so the frontend knows what's coming
    yield json.dumps({
        "type":           "header",
        "video_id":       video_id,
        "manual":         is_manual,
        "offset_applied": time_offset,
    }) + "\n"

    # Translate and stream in batches
    batch = []
    total = 0

    for entry in raw:
        german_text = entry.text.strip()
        if not german_text:
            continue

        try:
            english_text = translator.translate(german_text)
        except Exception as exc:
            logger.warning(f"Translation failed: {exc}")
            english_text = german_text

        adjusted_start = max(0.0, round(entry.start - time_offset, 3))
        adjusted_end   = max(0.0, round(entry.start + entry.duration - time_offset, 3))

        batch.append({
            "start":   adjusted_start,
            "end":     adjusted_end,
            "german":  german_text,
            "english": english_text,
        })

        if len(batch) >= BATCH_SIZE:
            yield json.dumps({"type": "batch", "cues": batch}) + "\n"
            total += len(batch)
            logger.info(f"  streamed {total} cues…")
            batch = []

    # Flush remaining
    if batch:
        yield json.dumps({"type": "batch", "cues": batch}) + "\n"
        total += len(batch)

    yield json.dumps({"type": "done", "total": total}) + "\n"
    logger.info(f"✅ Streamed {total} cues total.")


@app.get("/subtitles/{video_id}")
def get_subtitles(video_id: str, offset: float = DEFAULT_AUTO_OFFSET):
    logger.info(f"📥 {video_id}  offset={offset}")
    return StreamingResponse(
        stream_subtitles(video_id, offset),
        media_type="application/x-ndjson",
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/subtitles-by-url")
def get_subtitles_by_url(url: str, offset: float = DEFAULT_AUTO_OFFSET):
    """
    For non-YouTube videos: extract video ID from URL if possible,
    otherwise return a helpful error.
    Supports: youtube.com, youtu.be
    For other sites, the video must have a YouTube-sourced transcript.
    """
    import re
    # Try to extract YouTube ID from any YouTube URL format
    yt_match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if yt_match:
        return get_subtitles(yt_match.group(1), offset)
    raise HTTPException(
        status_code=400,
        detail="Non-YouTube video URLs are not supported for transcript fetching. "
               "Only YouTube videos have accessible transcripts via this API."
    )