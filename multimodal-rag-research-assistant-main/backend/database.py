import sqlite3
import os
import json
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "rag_assistant.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # Documents table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        title TEXT,
        authors TEXT,
        pages INTEGER DEFAULT 0,
        chunks_count INTEGER DEFAULT 0,
        figures_count INTEGER DEFAULT 0,
        added_at REAL NOT NULL,
        status TEXT DEFAULT 'indexed',
        filepath TEXT NOT NULL,
        arxiv_id TEXT,
        metadata_json TEXT
    )
    """)
    
    # Chunks table (both text and extracted figures)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        chunk_type TEXT NOT NULL DEFAULT 'text', -- 'text' or 'figure'
        content TEXT NOT NULL,
        image_path TEXT,
        metadata_json TEXT,
        FOREIGN KEY (doc_id) REFERENCES documents (id) ON DELETE CASCADE
    )
    """)
    
    # Chat sessions & history table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT 'default',
        doc_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations_json TEXT,
        figures_json TEXT,
        timestamp REAL NOT NULL
    )
    """)
    
    conn.commit()
    conn.close()

def save_document(doc: Dict[str, Any]):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT OR REPLACE INTO documents 
    (id, filename, title, authors, pages, chunks_count, figures_count, added_at, status, filepath, arxiv_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        doc["id"],
        doc["filename"],
        doc.get("title", doc["filename"]),
        doc.get("authors", ""),
        doc.get("pages", 0),
        doc.get("chunks_count", 0),
        doc.get("figures_count", 0),
        doc.get("added_at", 0),
        doc.get("status", "indexed"),
        doc.get("filepath", ""),
        doc.get("arxiv_id", None),
        json.dumps(doc.get("metadata", {}))
    ))
    conn.commit()
    conn.close()

def get_all_documents() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents ORDER BY added_at DESC")
    rows = cursor.fetchall()
    docs = []
    for r in rows:
        d = dict(r)
        if d.get("metadata_json"):
            try:
                d["metadata"] = json.loads(d["metadata_json"])
            except Exception:
                d["metadata"] = {}
        docs.append(d)
    conn.close()
    return docs

def get_document(doc_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents WHERE id = ?", (doc_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if d.get("metadata_json"):
        try:
            d["metadata"] = json.loads(d["metadata_json"])
        except Exception:
            d["metadata"] = {}
    return d

def delete_document(doc_id: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()

def update_document_metadata(doc_id: str, metadata: Dict[str, Any]):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE documents SET metadata_json = ? WHERE id = ?
    """, (json.dumps(metadata), doc_id))
    conn.commit()
    conn.close()

def clear_all_documents():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM chunks")
    cursor.execute("DELETE FROM documents")
    cursor.execute("DELETE FROM messages")
    conn.commit()
    conn.close()

def save_chunks(chunks: List[Dict[str, Any]]):
    if not chunks:
        return
    conn = get_connection()
    cursor = conn.cursor()
    for c in chunks:
        cursor.execute("""
        INSERT OR REPLACE INTO chunks 
        (id, doc_id, chunk_index, page_number, chunk_type, content, image_path, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            c["id"],
            c["doc_id"],
            c.get("chunk_index", 0),
            c.get("page_number", 1),
            c.get("chunk_type", "text"),
            c["content"],
            c.get("image_path", None),
            json.dumps(c.get("metadata", {}))
        ))
    conn.commit()
    conn.close()

def get_chunks_for_doc(doc_id: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM chunks WHERE doc_id = ? ORDER BY chunk_index ASC", (doc_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_all_chunks() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM chunks ORDER BY doc_id, chunk_index ASC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# Initialize tables immediately on import
init_db()
