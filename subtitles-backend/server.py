"""
Dual Subtitle Generator - server.py

Streaming batch translation with configurable source/target languages.
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

DEFAULT_AUTO_OFFSET = 1.5
BATCH_SIZE = 20


def get_best_transcript(video_id: str, source_lang: str):
    """
    Fetch the best available transcript for the given video.
    Prefers manual transcripts in the requested source language,
    falling back to auto-generated, then any available transcript.
    If source_lang is 'auto', picks the first available transcript.
    """
    api = YouTubeTranscriptApi()
    all_transcripts = list(api.list(video_id))

    logger.info("Available transcripts:")
    for t in all_transcripts:
        logger.info(f"  lang={t.language_code!r}  auto={t.is_generated}  name={t.language!r}")

    if source_lang and source_lang != "auto":
        # Exact manual match
        for t in all_transcripts:
            if t.language_code == source_lang and not t.is_generated:
                logger.info(f"✅ Manual {source_lang} ({t.language_code})")
                return t.fetch(), True
        # Prefix manual match (e.g. "de" matches "de-DE")
        for t in all_transcripts:
            if t.language_code.startswith(source_lang) and not t.is_generated:
                logger.info(f"✅ Manual {source_lang} prefix ({t.language_code})")
                return t.fetch(), True
        # Exact auto-generated match
        for t in all_transcripts:
            if t.language_code == source_lang and t.is_generated:
                logger.warning(f"⚠ Auto-generated {source_lang}")
                return t.fetch(), False
        # Prefix auto-generated match
        for t in all_transcripts:
            if t.language_code.startswith(source_lang) and t.is_generated:
                logger.warning(f"⚠ Auto-generated {source_lang} prefix ({t.language_code})")
                return t.fetch(), False

    # Fallback: any manual transcript
    for t in all_transcripts:
        if not t.is_generated:
            logger.warning(f"⚠ Fallback manual ({t.language_code})")
            return t.fetch(), True

    # Fallback: any auto-generated transcript
    for t in all_transcripts:
        if t.is_generated:
            logger.warning(f"⚠ Fallback auto-generated ({t.language_code})")
            return t.fetch(), False

    raise HTTPException(status_code=404, detail=f"No transcripts found for '{video_id}'")


def stream_subtitles(video_id: str, offset: float, source_lang: str, target_lang: str):
    """
    Generator yielding newline-delimited JSON.
    First message: metadata header.
    Subsequent: arrays of translated cue objects.
    """
    try:
        raw, is_manual = get_best_transcript(video_id, source_lang)
    except HTTPException as e:
        yield json.dumps({"error": e.detail}) + "\n"
        return
    except Exception as e:
        yield json.dumps({"error": str(e)}) + "\n"
        return

    time_offset = 0.0 if is_manual else offset

    # Resolve actual source language for the translator
    # Use "auto" if caller passed "auto" or if we fell back to an unknown lang
    translator_source = "auto" if source_lang == "auto" else source_lang

    translator = GoogleTranslator(source=translator_source, target=target_lang)

    yield json.dumps({
        "type":           "header",
        "video_id":       video_id,
        "source_lang":    source_lang,
        "target_lang":    target_lang,
        "manual":         is_manual,
        "offset_applied": time_offset,
    }) + "\n"

    batch = []
    total = 0

    for entry in raw:
        original_text = entry.text.strip()
        if not original_text:
            continue

        try:
            translated_text = translator.translate(original_text)
        except Exception as exc:
            logger.warning(f"Translation failed: {exc}")
            translated_text = original_text

        adjusted_start = max(0.0, round(entry.start - time_offset, 3))
        adjusted_end   = max(0.0, round(entry.start + entry.duration - time_offset, 3))

        batch.append({
            "start":      adjusted_start,
            "end":        adjusted_end,
            "original":   original_text,
            "translated": translated_text,
        })

        if len(batch) >= BATCH_SIZE:
            yield json.dumps({"type": "batch", "cues": batch}) + "\n"
            total += len(batch)
            logger.info(f"  streamed {total} cues…")
            batch = []

    if batch:
        yield json.dumps({"type": "batch", "cues": batch}) + "\n"
        total += len(batch)

    yield json.dumps({"type": "done", "total": total}) + "\n"
    logger.info(f"✅ Streamed {total} cues total.")


@app.get("/subtitles/{video_id}")
def get_subtitles(
    video_id: str,
    offset: float = DEFAULT_AUTO_OFFSET,
    source_lang: str = "auto",
    target_lang: str = "en",
):
    logger.info(f"📥 {video_id}  offset={offset}  {source_lang}→{target_lang}")
    return StreamingResponse(
        stream_subtitles(video_id, offset, source_lang, target_lang),
        media_type="application/x-ndjson",
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/subtitles-by-url")
def get_subtitles_by_url(
    url: str,
    offset: float = DEFAULT_AUTO_OFFSET,
    source_lang: str = "auto",
    target_lang: str = "en",
):
    import re
    yt_match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if yt_match:
        return get_subtitles(yt_match.group(1), offset, source_lang, target_lang)
    raise HTTPException(
        status_code=400,
        detail="Non-YouTube URLs are not supported. Only YouTube videos have accessible transcripts.",
    )
