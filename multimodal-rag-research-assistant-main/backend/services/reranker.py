import threading
from typing import List, Dict, Any

class Reranker:
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.model_name = model_name
        self._model = None
        self._is_loading = False
        self._load_failed = False
        # Kick off background loading so requests are never blocked
        self._start_background_load()

    def _start_background_load(self):
        if self._is_loading or self._model is not None:
            return
        self._is_loading = True
        thread = threading.Thread(target=self._load_model, daemon=True)
        thread.start()

    def _load_model(self):
        try:
            from sentence_transformers import CrossEncoder
            print(f"Loading CrossEncoder in background: {self.model_name}...")
            self._model = CrossEncoder(self.model_name)
            print(f"CrossEncoder {self.model_name} ready.")
        except Exception as e:
            print(f"Could not load CrossEncoder (falling back to hybrid score): {e}")
            self._load_failed = True
        finally:
            self._is_loading = False

    @property
    def model(self):
        return self._model

    def rerank(self, query: str, chunks: List[Dict[str, Any]], top_k: int = 5) -> List[Dict[str, Any]]:
        if not chunks:
            return []
        if self.model is None:
            # Model is still downloading/loading in background; return top-k candidates smoothly without blocking
            return chunks[:top_k]

        pairs = [[query, c["content"]] for c in chunks]
        try:
            scores = self.model.predict(pairs)
            for i, score in enumerate(scores):
                chunks[i]["rerank_score"] = float(score)

            reranked = sorted(chunks, key=lambda x: x.get("rerank_score", 0), reverse=True)
            return reranked[:top_k]
        except Exception as e:
            print(f"Error during reranking: {e}")
            return chunks[:top_k]

reranker = Reranker()
