import arxiv
import os
import re
import requests
from typing import Dict, Any, Optional

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

def clean_arxiv_id(query_or_url: str) -> str:
    """Extracts raw ArXiv ID from URL or messy string (e.g. 2312.00752v1 -> 2312.00752)"""
    match = re.search(r'(\d{4}\.\d{4,5})(?:v\d+)?', query_or_url)
    if match:
        return match.group(1)
    return query_or_url.strip()

def fetch_and_download_arxiv(arxiv_input: str) -> Dict[str, Any]:
    """
    Fetches paper metadata from ArXiv and downloads the PDF to backend uploads.
    """
    clean_id = clean_arxiv_id(arxiv_input)
    client = arxiv.Client()
    
    # Try searching by ID
    search = arxiv.Search(id_list=[clean_id])
    results = list(client.results(search))
    
    if not results:
        # Try query search if not an ID
        search = arxiv.Search(query=arxiv_input, max_results=1)
        results = list(client.results(search))
        
    if not results:
        raise ValueError(f"Could not find any paper on ArXiv matching: {arxiv_input}")
        
    paper = results[0]
    
    # Clean filename
    safe_title = re.sub(r'[^a-zA-Z0-9_\- ]+', '', paper.title)[:60].strip()
    filename = f"{paper.get_short_id()}_{safe_title}.pdf".replace(' ', '_')
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    # Download PDF (arxiv v4.x removed download_pdf from Result)
    pdf_response = requests.get(paper.pdf_url, timeout=120)
    pdf_response.raise_for_status()
    with open(filepath, "wb") as f:
        f.write(pdf_response.content)
    
    authors = [a.name for a in paper.authors]
    
    return {
        "arxiv_id": paper.get_short_id(),
        "title": paper.title,
        "authors": ", ".join(authors),
        "abstract": paper.summary,
        "published": paper.published.strftime("%Y-%m-%d") if paper.published else "",
        "pdf_url": paper.pdf_url,
        "filename": filename,
        "filepath": filepath
    }
