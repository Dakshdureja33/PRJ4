import os
import re
import json
import wave
import subprocess
import tempfile
import time
from typing import Dict, Any, List

import database
from services.gemini_service import get_configured_client, CANDIDATE_MODELS

PODCASTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "podcasts")
os.makedirs(PODCASTS_DIR, exist_ok=True)

def generate_podcast_script(title: str, chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generates an engaging, dual-speaker podcast script from academic paper content."""
    client = get_configured_client()
    if not client:
        return {
            "title": f"Deep Dive: {title}",
            "summary": "AI Audio Overview of research paper.",
            "dialogue": [
                {"speaker": "Alex", "text": f"Welcome to today's deep dive into {title}."},
                {"speaker": "Jordan", "text": "This paper presents compelling methodologies and findings worth examining."}
            ]
        }

    # Select representative chunks across beginning, middle, and figures
    text_sample = ""
    for c in chunks[:8]:
        text_sample += f"\n[Page {c.get('page_number', 1)}] {c.get('content', '')[:600]}\n"

    prompt = f"""
You are the executive producer of an acclaimed academic research podcast (like Google NotebookLM's Audio Overview).
Transform the following research paper context into a lively, insightful, and natural conversation between two researchers.

Speakers:
- Alex (Lead Host): Inquisitive, energetic, introduces the paper, asks the critical "why should we care?" questions.
- Jordan (Technical Co-Host): Sharp, analytical, breaks down the core architecture, datasets, benchmark numbers, and practical trade-offs.

Tone: Engaging, conversational, collegiate, and rigorous (avoid robotic jargon; explain concepts clearly with analogies).
Length: Exactly 6 to 8 conversational turns alternating between Alex and Jordan.

RESEARCH PAPER CONTEXT:
Paper Title: {title}
{text_sample}

CRITICAL: Return ONLY valid, raw JSON (no markdown fences, no explanation) with this structure:
{{
  "title": "A catchy episode title",
  "summary": "1-2 sentence compelling teaser of the episode",
  "dialogue": [
    {{"speaker": "Alex", "text": "..."}},
    {{"speaker": "Jordan", "text": "..."}}
  ]
}}
"""

    for model_name in CANDIDATE_MODELS:
        try:
            model = client.GenerativeModel(model_name)
            response = model.generate_content(prompt, request_options={"timeout": 30})
            if response and response.text:
                cleaned = response.text.strip()
                # Remove markdown fences if present
                if cleaned.startswith("```"):
                    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                    cleaned = re.sub(r"\s*```$", "", cleaned)
                parsed = json.loads(cleaned)
                if "dialogue" in parsed and isinstance(parsed["dialogue"], list):
                    return parsed
        except Exception as e:
            print(f"Podcast script generation error on {model_name}: {e}")
            continue

    # Fallback script if LLM formatting fails
    return {
        "title": f"Deep Dive: {title}",
        "summary": "A conversational synthesis of the paper's key methodologies and empirical findings.",
        "dialogue": [
            {"speaker": "Alex", "text": f"Welcome to our research overview. Today we're breaking down {title}."},
            {"speaker": "Jordan", "text": "It's an exciting piece of research that tackles some fundamental technical bottlenecks."},
            {"speaker": "Alex", "text": "What really stood out to me was the methodology they used."},
            {"speaker": "Jordan", "text": "Absolutely. By integrating structured evaluation with robust grounding, they achieved notable improvements over traditional baselines."}
        ]
    }

def synthesize_audio_file(dialogue: List[Dict[str, Any]], output_filepath: str) -> bool:
    """
    Synthesizes speech for each speaker turn using macOS 'say' and stitches them
    into a single unified WAV audio file.
    """
    has_say = subprocess.run(["which", "say"], capture_output=True).returncode == 0
    if not has_say:
        return False

    temp_files = []
    try:
        sample_rate = 22050
        # Create 0.25-second silence frame for natural pacing between speakers
        silence_frames = b"\x00\x00" * int(sample_rate * 0.25)
        all_frames = b""
        first_params = None

        for i, turn in enumerate(dialogue):
            speaker = turn.get("speaker", "Alex").lower()
            text = turn.get("text", "").replace('"', '\\"')
            if not text.strip():
                continue

            voice = "Samantha" if "alex" in speaker else "Daniel"
            turn_path = tempfile.mktemp(suffix=f"_turn_{i}.wav")
            temp_files.append(turn_path)

            # Generate speech turn
            cmd = ["say", "-v", voice, text, "-o", turn_path, "--data-format=LEI16@22050"]
            res = subprocess.run(cmd, capture_output=True, timeout=25)
            if res.returncode == 0 and os.path.exists(turn_path):
                with wave.open(turn_path, "rb") as w:
                    if first_params is None:
                        first_params = w.getparams()
                    all_frames += w.readframes(w.getnframes()) + silence_frames

        if all_frames and first_params is not None:
            with wave.open(output_filepath, "wb") as out:
                out.setparams(first_params)
                out.writeframes(all_frames)
            return True
        return False
    except Exception as e:
        print(f"Error during audio synthesis: {e}")
        return False
    finally:
        for tf in temp_files:
            if os.path.exists(tf):
                try:
                    os.remove(tf)
                except Exception:
                    pass

def get_or_create_audio_overview(doc_id: str) -> Dict[str, Any]:
    """Retrieves existing podcast or generates a new one for the document."""
    doc = database.get_document(doc_id)
    if not doc:
        raise ValueError(f"Document {doc_id} not found.")

    doc_title = doc.get("title") or doc.get("filename") or "Research Paper"
    audio_filename = f"{doc_id}_podcast.wav"
    audio_disk_path = os.path.join(PODCASTS_DIR, audio_filename)
    audio_url = f"/uploads/podcasts/{audio_filename}"

    # If audio already generated, check for cached metadata
    metadata = doc.get("metadata") or {}
    cached_podcast = metadata.get("audio_overview")
    if os.path.exists(audio_disk_path) and cached_podcast:
        return cached_podcast

    # 1. Generate Script
    chunks = database.get_chunks_for_doc(doc_id)
    script_data = generate_podcast_script(doc_title, chunks)

    # 2. Synthesize Audio
    has_audio = synthesize_audio_file(script_data["dialogue"], audio_disk_path)

    podcast_result = {
        "doc_id": doc_id,
        "paper_title": doc_title,
        "podcast_title": script_data.get("title", f"Deep Dive: {doc_title}"),
        "summary": script_data.get("summary", ""),
        "audio_url": audio_url if has_audio else None,
        "dialogue": script_data.get("dialogue", []),
        "generated_at": time.time(),
        "has_audio": has_audio
    }

    # Save to document metadata
    metadata["audio_overview"] = podcast_result
    database.update_document_metadata(doc_id, metadata)

    return podcast_result
