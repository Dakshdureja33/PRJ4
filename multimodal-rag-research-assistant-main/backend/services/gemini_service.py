import os
import google.generativeai as genai
from dotenv import load_dotenv
from PIL import Image
from typing import Optional, List, Dict, Any

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(env_path, override=True)

import time

CANDIDATE_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash"
]

# Circuit breaker for quota exhaustion
_vision_quota_exhausted_until = 0.0

def get_configured_client():
    load_dotenv(env_path, override=True)
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None
    genai.configure(api_key=api_key)
    return genai

def generate_image_summary(image_path: str, caption_context: str = "") -> str:
    """
    Extracts semantic meaning from an extracted scientific figure, chart, or table
    using Gemini Vision.
    """
    global _vision_quota_exhausted_until
    client = get_configured_client()
    if not client:
        return f"Figure/Table: {caption_context}" if caption_context else "Scientific diagram/figure."

    # Fast bypass if quota was recently exhausted so PDF ingestion stays blazing fast
    if time.time() < _vision_quota_exhausted_until:
        return f"Extracted figure/table from paper. {caption_context}".strip()

    prompt = f"""
    You are an expert scientific researcher. Analyze this extracted figure or table from an academic paper.
    Context / Nearby caption in text: "{caption_context}"

    Provide a concise, highly informative technical summary including:
    1. What diagram, architecture, or plot is shown.
    2. Key variables, axes, architecture components, or benchmark numbers.
    3. The main scientific takeaway or conclusion shown by this visual.
    Keep it within 3-4 sentences so it is optimal for semantic search indexing.
    """

    try:
        img = Image.open(image_path)
        for model_name in CANDIDATE_MODELS:
            try:
                model = client.GenerativeModel(model_name)
                response = model.generate_content([prompt, img], request_options={"timeout": 12})
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                err_msg = str(e).lower()
                if "resource_exhausted" in err_msg or "429" in err_msg:
                    # Trip circuit breaker for 5 minutes
                    _vision_quota_exhausted_until = time.time() + 300
                    break
                if any(t in err_msg for t in ["not found", "404", "504", "timeout", "503"]):
                    continue
                break
    except Exception as e:
        print(f"Error analyzing image {image_path}: {e}")

    return f"Extracted figure/table from paper. {caption_context}".strip()

def generate_grounded_answer(
    question: str, 
    context_chunks: List[Dict[str, Any]], 
    model_override: Optional[str] = None
) -> Dict[str, Any]:
    """
    Synthesizes a grounded answer from retrieved context chunks (text + figure descriptions).
    Instructs the LLM to provide page-level citations.
    """
    client = get_configured_client()
    if not client:
        return {
            "answer": "⚠️ Google API Key not configured. Please add `GOOGLE_API_KEY=your_key` to your backend/.env file.",
            "citations": []
        }

    formatted_context = ""
    for i, chunk in enumerate(context_chunks):
        p_num = chunk.get("page_number", 1)
        c_type = chunk.get("chunk_type", "text")
        doc_name = chunk.get("doc_name", "Document")
        content = chunk.get("content", "").strip()
        formatted_context += f"\n--- [Source {i+1} | {doc_name} | Page {p_num} | Type: {c_type.upper()}] ---\n{content}\n"

    prompt = f"""
You are a world-class AI Academic Research Assistant.
Answer the user's question with scientific rigor based ONLY on the provided context passages and figure descriptions.

CONTEXT:
{formatted_context}

USER QUESTION:
{question}

INSTRUCTIONS:
1. Provide a direct, thorough, and highly accurate answer.
2. Ground all facts and claims with bracketed page citations matching the source, e.g., `[Page X]` or `[Page X, Figure]`.
3. If the context mentions or explains a diagram, architecture figure, or table, reference it explicitly.
4. If the provided context does not contain enough information to answer definitively, clearly state what is known from the context and what is missing.
5. Do NOT hallucinate facts not present in the context.
"""

    models_to_try = [model_override] if model_override and model_override in CANDIDATE_MODELS else CANDIDATE_MODELS
    for m in CANDIDATE_MODELS:
        if m not in models_to_try:
            models_to_try.append(m)

    last_error = None
    for model_name in models_to_try:
        try:
            model = client.GenerativeModel(model_name)
            response = model.generate_content(prompt, request_options={"timeout": 35})
            if response and response.text:
                return {
                    "answer": response.text.strip(),
                    "model_used": model_name
                }
        except Exception as e:
            last_error = e
            err_msg = str(e).lower()
            if any(t in err_msg for t in ["not found", "404", "504", "timeout", "resource_exhausted", "429", "quota", "503", "rate limit", "busy"]):
                continue
            return {
                "answer": f"Gemini API Error: {str(e)}",
                "model_used": model_name
            }

    return {
        "answer": f"API temporarily busy or quota reached across models. (Details: {last_error})",
        "model_used": "none"
    }

def generate_paper_comparison(papers_context: List[Dict[str, Any]]) -> str:
    """
    Synthesizes a structured comparative matrix across multiple papers.
    """
    client = get_configured_client()
    if not client:
        return "⚠️ Google API Key not configured."

    context_str = ""
    for p in papers_context:
        context_str += f"\n### Paper: {p['title']} (Authors: {p.get('authors', 'N/A')})\n{p['summary']}\n"

    prompt = f"""
You are a senior academic reviewer. Compare the following research papers across these key dimensions:
1. Core Problem & Motivation
2. Methodology / Proposed Architecture
3. Datasets & Benchmarks Used
4. Key Quantitative Results
5. Limitations & Trade-offs

Format your output with:
- An Executive Comparison Summary (2 paragraphs)
- A detailed Markdown Comparison Table
- Key Synthesis / Which paper is best suited for what scenario

PAPERS CONTEXT:
{context_str}
"""

    for model_name in CANDIDATE_MODELS:
        try:
            model = client.GenerativeModel(model_name)
            response = model.generate_content(prompt, request_options={"timeout": 45})
            if response and response.text:
                return response.text.strip()
        except Exception:
            continue

    return "Failed to generate comparison matrix. Please try again."
