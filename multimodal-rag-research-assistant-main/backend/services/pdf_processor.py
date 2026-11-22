import os
import fitz  # PyMuPDF
import re
from typing import List, Dict, Any, Tuple
from services.gemini_service import generate_image_summary

FIGURES_BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "figures")
os.makedirs(FIGURES_BASE_DIR, exist_ok=True)

def extract_captions_from_text(page_text: str) -> List[str]:
    """Finds captions like 'Figure 1: ...', 'Fig. 2: ...', 'Table 1: ...'"""
    pattern = r'((?:Figure|Fig\.|Table)\s*\d+[:.\s][^\n\r]+(?:\n[^\n\r]+)?)'
    matches = re.findall(pattern, page_text, flags=re.IGNORECASE)
    return [m.strip().replace('\n', ' ') for m in matches]

def chunk_text_by_page(page_text: str, page_num: int, doc_id: str, start_chunk_idx: int, chunk_size: int = 500, overlap: int = 100) -> List[Dict[str, Any]]:
    """Chunks text while preserving exact page number metadata."""
    if not page_text.strip():
        return []
    
    words = page_text.split()
    chunks = []
    chunk_idx = start_chunk_idx
    
    # Calculate word-based step approximating character chunk_size
    words_per_chunk = max(30, chunk_size // 5)
    word_overlap = max(5, overlap // 5)
    step = max(10, words_per_chunk - word_overlap)
    
    for i in range(0, len(words), step):
        chunk_words = words[i:i + words_per_chunk]
        chunk_content = " ".join(chunk_words).strip()
        if len(chunk_content) > 30:
            chunks.append({
                "id": f"{doc_id}_chunk_{chunk_idx}",
                "doc_id": doc_id,
                "chunk_index": chunk_idx,
                "page_number": page_num,
                "chunk_type": "text",
                "content": chunk_content,
                "image_path": None,
                "metadata": {"page": page_num, "type": "text"}
            })
            chunk_idx += 1
            
    return chunks

def process_pdf_document(
    filepath: str, 
    doc_id: str, 
    chunk_size: int = 500, 
    chunk_overlap: int = 100,
    enable_vision: bool = True
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Multimodal PDF Ingestion:
    1. Extracts full text with page-level mapping.
    2. Detects and extracts embedded diagrams, charts, and figures.
    3. Analyzes figures using Gemini Vision for dense semantic indexing.
    4. Returns document metadata, all chunks (text + figures), and extracted figure assets.
    """
    doc_figures_dir = os.path.join(FIGURES_BASE_DIR, doc_id)
    os.makedirs(doc_figures_dir, exist_ok=True)
    
    doc = fitz.open(filepath)
    total_pages = len(doc)
    
    all_chunks = []
    extracted_figures = []
    full_text = ""
    chunk_counter = 0
    
    # Attempt to extract academic paper title from metadata or first page header
    doc_title = os.path.basename(filepath)
    if doc.metadata and doc.metadata.get("title") and len(doc.metadata.get("title").strip()) > 3:
        doc_title = doc.metadata.get("title").strip()
    else:
        # Check first page lines for probable title
        first_page = doc[0].get_text() if total_pages > 0 else ""
        first_lines = [l.strip() for l in first_page.split("\n") if len(l.strip()) > 10]
        if first_lines:
            doc_title = first_lines[0][:120]

    for page_idx in range(total_pages):
        page = doc[page_idx]
        page_num = page_idx + 1
        page_text = page.get_text()
        full_text += f"\n--- Page {page_num} ---\n" + page_text
        
        # 1. Text chunking with page grounding
        text_chunks = chunk_text_by_page(
            page_text=page_text, 
            page_num=page_num, 
            doc_id=doc_id, 
            start_chunk_idx=chunk_counter,
            chunk_size=chunk_size,
            overlap=chunk_overlap
        )
        for tc in text_chunks:
            all_chunks.append(tc)
            chunk_counter += 1
            
        # 2. Multimodal Figure & Diagram Extraction
        image_list = page.get_images(full=True)
        captions = extract_captions_from_text(page_text)
        
        for img_idx, img in enumerate(image_list):
            xref = img[0]
            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image.get("ext", "png")
                width = base_image.get("width", 0)
                height = base_image.get("height", 0)
                
                # Filter out small icons, buttons, math glyphs, or decorative banners
                if width < 120 or height < 120:
                    continue
                
                fig_filename = f"fig_p{page_num}_{img_idx}.{image_ext}"
                fig_filepath = os.path.join(doc_figures_dir, fig_filename)
                
                with open(fig_filepath, "wb") as f:
                    f.write(image_bytes)
                    
                caption_hint = captions[min(img_idx, len(captions) - 1)] if captions else ""
                rel_url = f"/uploads/figures/{doc_id}/{fig_filename}"
                
                figure_data = {
                    "id": f"{doc_id}_fig_{page_num}_{img_idx}",
                    "doc_id": doc_id,
                    "page_number": page_num,
                    "image_url": rel_url,
                    "filepath": fig_filepath,
                    "caption": caption_hint or f"Figure on page {page_num}",
                    "summary": f"Visual element (Figure/Table) from page {page_num}. {caption_hint}".strip(),
                    "dimensions": f"{width}x{height}",
                    "area": width * height,
                    "has_caption": bool(caption_hint)
                }
                extracted_figures.append(figure_data)
            except Exception as e:
                print(f"Failed to extract image xref {xref} on page {page_num}: {e}")

    # Parallelize vision analysis for top figures (up to 4 key figures per document)
    if enable_vision and extracted_figures:
        # Prioritize figures with captions or largest area
        sorted_candidates = sorted(
            extracted_figures, 
            key=lambda x: (x["has_caption"], x["area"]), 
            reverse=True
        )
        vision_targets = sorted_candidates[:4]
        
        from concurrent.futures import ThreadPoolExecutor
        def analyze_fig(fig_item):
            try:
                summary = generate_image_summary(fig_item["filepath"], fig_item["caption"])
                fig_item["summary"] = summary
            except Exception as err:
                print(f"Error in vision summary for {fig_item['id']}: {err}")

        with ThreadPoolExecutor(max_workers=3) as executor:
            list(executor.map(analyze_fig, vision_targets))

    # Add multimodal figure chunks to all_chunks
    for fig in extracted_figures:
        p_num = fig["page_number"]
        v_summary = fig["summary"]
        c_hint = fig["caption"]
        r_url = fig["image_url"]

        all_chunks.append({
            "id": f"{doc_id}_chunk_{chunk_counter}",
            "doc_id": doc_id,
            "chunk_index": chunk_counter,
            "page_number": p_num,
            "chunk_type": "figure",
            "content": f"[FIGURE / DIAGRAM on Page {p_num}]: {v_summary}\nCaption: {c_hint}",
            "image_path": r_url,
            "metadata": {
                "page": p_num, 
                "type": "figure", 
                "image_url": r_url,
                "caption": c_hint
            }
        })
        chunk_counter += 1

    doc_metadata = {
        "id": doc_id,
        "filename": os.path.basename(filepath),
        "title": doc_title,
        "pages": total_pages,
        "chunks_count": len(all_chunks),
        "figures_count": len(extracted_figures),
        "characters_extracted": len(full_text),
        "filepath": filepath
    }
    
    return doc_metadata, all_chunks, extracted_figures
