import os
import faiss
import numpy as np
import json
from typing import List, Dict, Any, Optional
from sentence_transformers import SentenceTransformer
from rank_bm25 import BM25Okapi
import database

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
FAISS_INDEX_PATH = os.path.join(DATA_DIR, "faiss_index.bin")
CHUNKS_MAP_PATH = os.path.join(DATA_DIR, "chunks_map.json")

class HybridSearchEngine:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        print(f"Initializing HybridSearchEngine with {model_name}...")
        self.embedding_model = SentenceTransformer(model_name)
        self.dimension = self.embedding_model.get_sentence_embedding_dimension()
        self.faiss_index: Optional[faiss.IndexFlatL2] = None
        self.chunk_ids: List[str] = []
        self.bm25: Optional[BM25Okapi] = None
        self.cached_chunks: Dict[str, Dict[str, Any]] = {}
        
        self.load_index()

    def _tokenize(self, text: str) -> List[str]:
        return [w.lower() for w in text.split() if len(w) > 1]

    def load_index(self):
        """Loads index from disk or rebuilds from SQLite database."""
        all_db_chunks = database.get_all_chunks()
        if not all_db_chunks:
            self.faiss_index = faiss.IndexFlatL2(self.dimension)
            self.chunk_ids = []
            self.bm25 = None
            self.cached_chunks = {}
            return

        self.cached_chunks = {c["id"]: c for c in all_db_chunks}
        self.chunk_ids = [c["id"] for c in all_db_chunks]

        # Rebuild or load FAISS
        if os.path.exists(FAISS_INDEX_PATH) and os.path.exists(CHUNKS_MAP_PATH):
            try:
                self.faiss_index = faiss.read_index(FAISS_INDEX_PATH)
                with open(CHUNKS_MAP_PATH, "r") as f:
                    saved_ids = json.load(f)
                if len(saved_ids) == len(self.chunk_ids):
                    self.chunk_ids = saved_ids
            except Exception as e:
                print(f"Error reading persistent FAISS index, rebuilding: {e}")
                self._rebuild_faiss([c["content"] for c in all_db_chunks])
        else:
            self._rebuild_faiss([c["content"] for c in all_db_chunks])

        # Build BM25 index
        tokenized_corpus = [self._tokenize(c["content"]) for c in all_db_chunks]
        if tokenized_corpus:
            self.bm25 = BM25Okapi(tokenized_corpus)

    def _rebuild_faiss(self, texts: List[str]):
        self.faiss_index = faiss.IndexFlatL2(self.dimension)
        if texts:
            embeddings = self.embedding_model.encode(texts, show_progress_bar=False)
            embeddings = np.array(embeddings).astype("float32")
            self.faiss_index.add(embeddings)
            self.save_index()

    def save_index(self):
        if self.faiss_index is not None:
            faiss.write_index(self.faiss_index, FAISS_INDEX_PATH)
            with open(CHUNKS_MAP_PATH, "w") as f:
                json.dump(self.chunk_ids, f)

    def add_chunks(self, chunks: List[Dict[str, Any]]):
        """Adds new document chunks to both FAISS and BM25 persistent indexes."""
        if not chunks:
            return

        texts = [c["content"] for c in chunks]
        embeddings = self.embedding_model.encode(texts, show_progress_bar=False)
        embeddings = np.array(embeddings).astype("float32")

        if self.faiss_index is None:
            self.faiss_index = faiss.IndexFlatL2(self.dimension)

        self.faiss_index.add(embeddings)
        new_ids = [c["id"] for c in chunks]
        self.chunk_ids.extend(new_ids)
        for c in chunks:
            self.cached_chunks[c["id"]] = c

        self.save_index()

        # Re-index BM25 with all cached chunks
        all_chunks = list(self.cached_chunks.values())
        tokenized_corpus = [self._tokenize(c["content"]) for c in all_chunks]
        if tokenized_corpus:
            self.bm25 = BM25Okapi(tokenized_corpus)

    def reset(self):
        self.faiss_index = faiss.IndexFlatL2(self.dimension)
        self.chunk_ids = []
        self.bm25 = None
        self.cached_chunks = {}
        if os.path.exists(FAISS_INDEX_PATH):
            os.remove(FAISS_INDEX_PATH)
        if os.path.exists(CHUNKS_MAP_PATH):
            os.remove(CHUNKS_MAP_PATH)

    def search_hybrid(
        self, 
        query: str, 
        doc_id: Optional[str] = None, 
        top_k: int = 5,
        dense_weight: float = 0.6,
        sparse_weight: float = 0.4
    ) -> List[Dict[str, Any]]:
        """
        Executes Reciprocal Rank Fusion (RRF) combining:
        1. Dense semantic search (FAISS)
        2. Sparse keyword search (BM25Okapi)
        Optionally filters results to a specific document or whole corpus.
        """
        if not self.chunk_ids or not self.cached_chunks:
            return []

        # 1. Dense FAISS Search
        dense_ranks: Dict[str, int] = {}
        query_emb = self.embedding_model.encode([query])
        query_emb = np.array(query_emb).astype("float32")
        
        # Retrieve more candidates for RRF fusion
        k_search = min(len(self.chunk_ids), max(top_k * 3, 20))
        distances, indices = self.faiss_index.search(query_emb, k_search)
        
        for rank, idx in enumerate(indices[0]):
            if idx != -1 and idx < len(self.chunk_ids):
                c_id = self.chunk_ids[idx]
                dense_ranks[c_id] = rank + 1

        # 2. Sparse BM25 Search
        sparse_ranks: Dict[str, int] = {}
        if self.bm25:
            tokens = self._tokenize(query)
            if tokens:
                bm25_scores = self.bm25.get_scores(tokens)
                top_sparse_idx = np.argsort(bm25_scores)[::-1][:k_search]
                for rank, idx in enumerate(top_sparse_idx):
                    if idx < len(self.chunk_ids) and bm25_scores[idx] > 0.001:
                        c_id = self.chunk_ids[idx]
                        sparse_ranks[c_id] = rank + 1

        # 3. Reciprocal Rank Fusion (RRF) with constant k=60
        rrf_k = 60
        candidate_ids = set(dense_ranks.keys()).union(set(sparse_ranks.keys()))
        fused_scores = {}

        for c_id in candidate_ids:
            chunk = self.cached_chunks.get(c_id)
            if not chunk:
                continue

            # Document-specific filter if requested
            if doc_id and chunk.get("doc_id") != doc_id:
                continue

            score = 0.0
            if c_id in dense_ranks:
                score += dense_weight * (1.0 / (rrf_k + dense_ranks[c_id]))
            if c_id in sparse_ranks:
                score += sparse_weight * (1.0 / (rrf_k + sparse_ranks[c_id]))
            
            # Slight boost if chunk is a figure when query asks about visual elements
            q_lower = query.lower()
            is_visual_query = any(w in q_lower for w in ["figure", "fig", "table", "diagram", "chart", "plot", "architecture"])
            if is_visual_query and chunk.get("chunk_type") == "figure":
                score *= 1.3

            fused_scores[c_id] = score

        # Sort candidates by fused score
        sorted_candidates = sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)
        results = []
        for c_id, score in sorted_candidates[:top_k]:
            c = dict(self.cached_chunks[c_id])
            c["rrf_score"] = float(score)
            results.append(c)

        return results

# Singleton instance for backend reuse
search_engine = HybridSearchEngine()
