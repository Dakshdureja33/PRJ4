const API = "/api";

export async function fetchDocuments() {
  const response = await fetch(`${API}/documents`);
  if (!response.ok) {
    throw new Error(`Failed to load documents (${response.status})`);
  }
  return response.json();
}

export async function uploadDocument(file, options = {}) {
  const formData = new FormData();
  formData.append("file", file);
  if (options.chunkSize) formData.append("chunk_size", options.chunkSize);
  formData.append("enable_vision", options.enableVision !== false ? "true" : "false");

  const response = await fetch(`${API}/upload-pdf`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Upload failed (${response.status})`);
  }

  return response.json();
}

export async function importArxiv(queryOrUrl) {
  const response = await fetch(`${API}/arxiv/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query_or_url: queryOrUrl }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `ArXiv import failed (${response.status})`);
  }

  return response.json();
}

export async function askQuestion(query, options = {}) {
  const payload = {
    query,
    doc_id: options.docId || null,
    top_k: options.topK || 5,
    enable_reranker: options.enableReranker !== false,
    enable_hybrid: options.enableHybrid !== false,
    model_name: options.modelName || null,
  };

  const response = await fetch(`${API}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${response.status})`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

export async function comparePapers(docIds) {
  const response = await fetch(`${API}/compare-papers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_ids: docIds }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Paper comparison failed");
  }

  return response.json();
}

export async function getBibtex(docId) {
  const response = await fetch(`${API}/documents/${docId}/bibtex`);
  if (!response.ok) throw new Error("Failed to fetch BibTeX");
  const data = await response.json();
  return data.bibtex;
}

export async function getAudioOverview(docId) {
  const response = await fetch(`${API}/documents/${docId}/audio-overview`, {
    method: "POST",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate audio overview.");
  }
  return response.json();
}

export async function deleteDocument(docId) {
  const response = await fetch(`${API}/documents/${docId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete document");
  return response.json();
}

export async function clearAllDocuments() {
  const response = await fetch(`${API}/clear-all`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to clear documents");
  return response.json();
}

export async function runEvaluation() {
  const response = await fetch(`${API}/evaluation/run`, { method: "POST" });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Evaluation benchmark failed");
  }
  return response.json();
}

export async function checkHealth() {
  try {
    const response = await fetch(`${API}/`);
    return response.ok;
  } catch {
    return false;
  }
}
