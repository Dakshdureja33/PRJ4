import os
import time
import uuid
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import fitz

import database
from services.pdf_processor import process_pdf_document
from services.hybrid_search import search_engine
from services.reranker import reranker
from services.gemini_service import generate_grounded_answer
from services.arxiv_service import fetch_and_download_arxiv
from services.synthesis_service import generate_bibtex, compare_selected_documents
from evaluation.benchmark import (
    DEFAULT_BENCHMARK_QUERIES, 
    evaluate_faithfulness_llm, 
    evaluate_answer_relevance, 
    evaluate_retrieval_precision
)

app = FastAPI(
    title="Multimodal RAG Research Assistant API",
    version="2.0.0",
    description="Advanced multimodal research assistant featuring hybrid search, vision grounding, cross-document comparison, and ArXiv ingestion."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
FIGURES_DIR = os.path.join(UPLOAD_DIR, "figures")
os.makedirs(FIGURES_DIR, exist_ok=True)
PAGES_CACHE_DIR = os.path.join(UPLOAD_DIR, "rendered_pages")
os.makedirs(PAGES_CACHE_DIR, exist_ok=True)

# Mount static folder for previewing uploaded PDFs and extracted figure images
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

class AskRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    query: str
    doc_id: Optional[str] = None
    top_k: int = 5
    enable_reranker: bool = True
    enable_hybrid: bool = True
    model_name: Optional[str] = None

class ArxivImportRequest(BaseModel):
    query_or_url: str

class CompareRequest(BaseModel):
    doc_ids: List[str]

from starlette.concurrency import run_in_threadpool

@app.get("/")
def home():
    all_docs = database.get_all_documents()
    all_chunks = database.get_all_chunks()
    return {
        "status": "online",
        "system": "Multimodal RAG Research Assistant",
        "version": "2.0.0",
        "total_documents": len(all_docs),
        "total_chunks_indexed": len(all_chunks),
        "active_models": {
            "embedding": "all-MiniLM-L6-v2",
            "reranker": "ms-marco-MiniLM-L-6-v2",
            "llm": "Gemini 2.5 Flash / Gemini Vision"
        }
    }

@app.get("/documents")
def list_documents():
    return database.get_all_documents()

@app.post("/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    chunk_size: int = Form(500),
    enable_vision: bool = Form(True)
):
    doc_id = str(uuid.uuid4())[:8]
    clean_filename = f"{doc_id}_{file.filename}"
    filepath = os.path.join(UPLOAD_DIR, clean_filename)

    with open(filepath, "wb") as buffer:
        buffer.write(await file.read())

    # Process PDF with multimodal extraction in worker thread
    try:
        doc_meta, chunks, figures = await run_in_threadpool(
            process_pdf_document,
            filepath=filepath,
            doc_id=doc_id,
            chunk_size=chunk_size,
            enable_vision=enable_vision
        )
        
        doc_meta["filename"] = file.filename
        doc_meta["added_at"] = time.time()
        doc_meta["status"] = "indexed"
        
        # Save to SQLite persistence and vector search
        await run_in_threadpool(database.save_document, doc_meta)
        await run_in_threadpool(database.save_chunks, chunks)
        await run_in_threadpool(search_engine.add_chunks, chunks)

        return {
            "id": doc_id,
            "filename": file.filename,
            "title": doc_meta["title"],
            "pages": doc_meta["pages"],
            "total_chunks": len(chunks),
            "figures_extracted": len(figures),
            "characters_extracted": doc_meta["characters_extracted"],
            "status": "indexed",
            "figures": figures[:5] # sample of extracted figures
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")

@app.post("/arxiv/import")
def import_from_arxiv(request: ArxivImportRequest):
    try:
        paper_info = fetch_and_download_arxiv(request.query_or_url)
        doc_id = str(uuid.uuid4())[:8]
        
        doc_meta, chunks, figures = process_pdf_document(
            filepath=paper_info["filepath"],
            doc_id=doc_id,
            chunk_size=500,
            enable_vision=True
        )

        doc_meta["title"] = paper_info["title"]
        doc_meta["authors"] = paper_info["authors"]
        doc_meta["arxiv_id"] = paper_info["arxiv_id"]
        doc_meta["filename"] = paper_info["filename"]
        doc_meta["added_at"] = time.time()
        doc_meta["status"] = "indexed"
        doc_meta["metadata"] = {
            "abstract": paper_info["abstract"],
            "published": paper_info["published"],
            "pdf_url": paper_info["pdf_url"]
        }

        database.save_document(doc_meta)
        database.save_chunks(chunks)
        search_engine.add_chunks(chunks)

        return {
            "id": doc_id,
            "title": paper_info["title"],
            "authors": paper_info["authors"],
            "arxiv_id": paper_info["arxiv_id"],
            "pages": doc_meta["pages"],
            "total_chunks": len(chunks),
            "figures_extracted": len(figures),
            "status": "indexed"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"ArXiv Import failed: {str(e)}")

@app.get("/ask")
def ask_question_get(
    query: str, 
    doc_id: Optional[str] = None, 
    top_k: int = 5,
    enable_reranker: bool = True
):
    """GET endpoint compatible with existing frontend API."""
    return process_ask(query, doc_id, top_k, enable_reranker, enable_hybrid=True)

@app.post("/ask")
def ask_question_post(req: AskRequest):
    """Full-featured POST endpoint accepting JSON parameters."""
    return process_ask(
        query=req.query,
        doc_id=req.doc_id,
        top_k=req.top_k,
        enable_reranker=req.enable_reranker,
        enable_hybrid=req.enable_hybrid,
        model_name=req.model_name
    )

def process_ask(
    query: str, 
    doc_id: Optional[str], 
    top_k: int, 
    enable_reranker: bool, 
    enable_hybrid: bool,
    model_name: Optional[str] = None
):
    all_chunks = database.get_all_chunks()
    if not all_chunks:
        return {"error": "No documents indexed yet. Upload a PDF or import an ArXiv paper first."}

    # 1. Hybrid Retrieval (Dense FAISS + Sparse BM25 with RRF)
    dense_w = 0.6 if enable_hybrid else 1.0
    sparse_w = 0.4 if enable_hybrid else 0.0

    # Retrieve slightly more candidates for reranker
    k_retrieve = top_k * 2 if enable_reranker else top_k
    retrieved_chunks = search_engine.search_hybrid(
        query=query,
        doc_id=doc_id if doc_id and doc_id != "all" else None,
        top_k=k_retrieve,
        dense_weight=dense_w,
        sparse_weight=sparse_w
    )

    if not retrieved_chunks:
        return {
            "question": query,
            "answer": "No relevant content found in the selected document(s) matching your query.",
            "context": "",
            "figures": [],
            "citations": []
        }

    # 2. Cross-Encoder Reranking
    if enable_reranker:
        retrieved_chunks = reranker.rerank(query, retrieved_chunks, top_k=top_k)
    else:
        retrieved_chunks = retrieved_chunks[:top_k]

    # Resolve document names for citations
    for c in retrieved_chunks:
        doc = database.get_document(c["doc_id"])
        c["doc_name"] = doc["title"] if doc else "Document"

    # 3. Grounded Multimodal Generation via Gemini
    gen_result = generate_grounded_answer(
        question=query,
        context_chunks=retrieved_chunks,
        model_override=model_name
    )

    # 4. Extract visual figures retrieved in context
    visual_figures = []
    seen_urls = set()
    for c in retrieved_chunks:
        if c.get("chunk_type") == "figure" and c.get("image_path"):
            if c["image_path"] not in seen_urls:
                seen_urls.add(c["image_path"])
                visual_figures.append({
                    "image_url": c["image_path"],
                    "page": c.get("page_number", 1),
                    "summary": c.get("content", "")
                })

    formatted_context = "\n\n".join([f"[Page {c.get('page_number', 1)}] {c['content']}" for c in retrieved_chunks])

    return {
        "question": query,
        "answer": gen_result["answer"],
        "model_used": gen_result.get("model_used"),
        "context": formatted_context,
        "retrieved_chunks": retrieved_chunks,
        "figures": visual_figures,
        "doc_id": doc_id
    }

@app.post("/compare-papers")
def compare_papers(req: CompareRequest):
    return compare_selected_documents(req.doc_ids)

@app.get("/documents/{doc_id}/bibtex")
def get_bibtex(doc_id: str):
    doc = database.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"bibtex": generate_bibtex(doc)}

@app.get("/documents/{doc_id}/page/{page_num}")
async def get_document_page(doc_id: str, page_num: int):
    doc = database.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    filepath = doc.get("filepath")
    if not filepath or not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, doc.get("filename", ""))
        if not os.path.exists(filepath):
            raise HTTPException(status_code=404, detail="Document file not found on disk")
    
    doc_cache_dir = os.path.join(PAGES_CACHE_DIR, doc_id)
    os.makedirs(doc_cache_dir, exist_ok=True)
    page_img_path = os.path.join(doc_cache_dir, f"page_{page_num}.jpg")
    
    if not os.path.exists(page_img_path):
        def render_page():
            pdf_doc = fitz.open(filepath)
            try:
                if page_num < 1 or page_num > len(pdf_doc):
                    raise HTTPException(status_code=400, detail=f"Page {page_num} out of bounds (1-{len(pdf_doc)})")
                page = pdf_doc[page_num - 1]
                pix = page.get_pixmap(dpi=150)
                pix.save(page_img_path, "jpeg")
            finally:
                pdf_doc.close()
        
        await run_in_threadpool(render_page)
        
    return FileResponse(page_img_path, media_type="image/jpeg")

from services.audio_overview_service import get_or_create_audio_overview

@app.post("/documents/{doc_id}/audio-overview")
async def document_audio_overview(doc_id: str):
    doc = database.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        overview = await run_in_threadpool(get_or_create_audio_overview, doc_id)
        return overview
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate audio overview: {str(e)}")

@app.delete("/documents/{doc_id}")
def delete_doc(doc_id: str):
    database.delete_document(doc_id)
    search_engine.load_index()
    return {"success": True, "message": f"Document {doc_id} deleted."}

@app.post("/clear-all")
def clear_all():
    database.clear_all_documents()
    search_engine.reset()
    return {"success": True, "message": "All documents and vector indexes cleared."}

@app.post("/evaluation/run")
def run_evaluation():
    docs = database.get_all_documents()
    if not docs:
        raise HTTPException(status_code=400, detail="Upload at least one paper before running evaluation benchmark.")

    test_doc = docs[0]
    queries = DEFAULT_BENCHMARK_QUERIES[:3]
    eval_results = []

    for q_item in queries:
        q = q_item["query"]
        t0 = time.time()
        chunks = search_engine.search_hybrid(q, doc_id=test_doc["id"], top_k=4)
        chunks = reranker.rerank(q, chunks, top_k=3)
        gen = generate_grounded_answer(q, chunks)
        latency = round((time.time() - t0) * 1000, 1)

        ctx_str = "\n".join([c["content"] for c in chunks])
        f_score = evaluate_faithfulness_llm(gen["answer"], ctx_str)
        r_score = evaluate_answer_relevance(q, gen["answer"])
        p_score = evaluate_retrieval_precision(chunks, q_item["expected_keywords"])

        eval_results.append({
            "query": q,
            "type": q_item["type"],
            "faithfulness": f_score,
            "relevance": r_score,
            "precision": p_score,
            "latency_ms": latency
        })

    avg_faithfulness = round(sum([r["faithfulness"] for r in eval_results]) / len(eval_results), 2)
    avg_relevance = round(sum([r["relevance"] for r in eval_results]) / len(eval_results), 2)
    avg_precision = round(sum([r["precision"] for r in eval_results]) / len(eval_results), 2)

    return {
        "status": "completed",
        "paper_evaluated": test_doc.get("title", test_doc["filename"]),
        "summary_metrics": {
            "avg_faithfulness": avg_faithfulness,
            "avg_answer_relevance": avg_relevance,
            "avg_context_precision": avg_precision
        },
        "detailed_queries": eval_results
    }