from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from youtube_transcript_api import YouTubeTranscriptApi # We import the class directly

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/get-subtitles/{video_id}")
def get_subtitles(video_id: str):
    try:
        # Since we imported the class above, we call the method on it directly
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        
        print(f"✅ Success! Sent subtitles for {video_id}")
        return {"status": "success", "data": transcript[:15]}
        
    except Exception as e:
        print(f"❌ Python Error: {str(e)}")
        return {"status": "error", "message": f"Python Error: {str(e)}"}

@app.get("/")
def home():
    return {"status": "online"}