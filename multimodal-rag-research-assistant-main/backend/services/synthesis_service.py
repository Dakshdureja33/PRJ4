import re
import datetime
from typing import Dict, Any, List
import database
from services.gemini_service import generate_paper_comparison

def generate_bibtex(doc: Dict[str, Any]) -> str:
    """Generates standard BibTeX entry for an academic document."""
    title = doc.get("title", doc.get("filename", "Untitled Paper"))
    authors = doc.get("authors", "Unknown Authors")
    arxiv_id = doc.get("arxiv_id", "")
    
    # Generate clean citation key
    first_author = authors.split(",")[0].strip().split()[-1] if authors else "Author"
    first_author_clean = re.sub(r'[^a-zA-Z]', '', first_author).lower() or "author"
    year = datetime.datetime.now().year
    
    key = f"{first_author_clean}{year}{re.sub(r'[^a-zA-Z]', '', title)[:8].lower()}"
    
    if arxiv_id:
        return f"""@article{{{key},
  title = {{{title}}},
  author = {{{authors}}},
  journal = {{arXiv preprint arXiv:{arxiv_id}}},
  year = {{{year}}},
  url = {{https://arxiv.org/abs/{arxiv_id}}}
}}"""
    else:
        return f"""@article{{{key},
  title = {{{title}}},
  author = {{{authors}}},
  year = {{{year}}},
  note = {{Indexed via Multimodal RAG Research Assistant}}
}}"""

def compare_selected_documents(doc_ids: List[str]) -> Dict[str, Any]:
    """Retrieves document abstracts and top chunks to generate a comparative analysis."""
    papers_context = []
    
    for doc_id in doc_ids:
        doc = database.get_document(doc_id)
        if not doc:
            continue
            
        chunks = database.get_chunks_for_doc(doc_id)
        # Gather abstract and first few chunks
        first_chunks = chunks[:4]
        summary_text = "\n".join([c["content"] for c in first_chunks])
        
        papers_context.append({
            "id": doc_id,
            "title": doc.get("title", doc["filename"]),
            "authors": doc.get("authors", "N/A"),
            "summary": summary_text
        })
        
    if len(papers_context) < 2:
        return {
            "error": "Please select at least 2 indexed documents to perform comparative analysis."
        }
        
    comparison_markdown = generate_paper_comparison(papers_context)
    
    return {
        "compared_papers": [p["title"] for p in papers_context],
        "comparison_markdown": comparison_markdown
    }
