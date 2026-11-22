"""
Gemini Service wrapper (backward-compatible).
Re-exports from services.gemini_service for legacy tests and scripts.
"""

from services.gemini_service import (
    generate_grounded_answer,
    generate_image_summary,
    generate_paper_comparison,
    get_configured_client,
    CANDIDATE_MODELS
)

def generate_answer(question: str, context: str, model_override: str = None) -> str:
    """
    Backward-compatible wrapper for single string context calls.
    """
    dummy_chunks = [{
        "content": context,
        "page_number": 1,
        "doc_name": "Document",
        "chunk_type": "text"
    }]
    res = generate_grounded_answer(question, dummy_chunks, model_override=model_override)
    return res.get("answer", "")