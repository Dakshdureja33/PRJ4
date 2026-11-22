import { useEffect, useRef, useState } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import Library from "./pages/Library";
import Assistant from "./pages/Assistant";
import Settings from "./pages/Settings";
import { AudioOverviewModal } from "./components/AudioOverviewModal";
import {
  askQuestion,
  uploadDocument,
  importArxiv,
  fetchDocuments,
  deleteDocument,
  clearAllDocuments,
  getBibtex,
  comparePapers,
  getAudioOverview
} from "./api";

const DEFAULT_SETTINGS = {
  llm: "Gemini 3.1 Flash-Lite (Recommended)",
  embedding: "Sentence Transformers (all-MiniLM-L6-v2)",
  vectorDb: "Hybrid (BM25 + FAISS with RRF)",
  enableReranker: true,
  topK: 5,
  chunkSize: 500,
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

let nextId = Date.now();
const uid = () => String(nextId++);

function App() {
  const [page, setPage] = useState(() => load("rag.page", "library"));
  const [docs, setDocs] = useState([]);
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...load("rag.settings", {}) }));
  const [messages, setMessages] = useState(() => load("rag.messages", []));
  const [activeDocId, setActiveDocId] = useState(() => load("rag.activeDoc", "all"));
  const [loading, setLoading] = useState(false);

  // NotebookLM Audio Overview Podcast State
  const [audioModalOpen, setAudioModalOpen] = useState(false);
  const [audioData, setAudioData] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioDoc, setAudioDoc] = useState(null);

  const handleOpenAudio = async (doc) => {
    if (!doc) return;
    setAudioDoc(doc);
    setAudioModalOpen(true);
    setAudioLoading(true);
    try {
      const res = await getAudioOverview(doc.id);
      setAudioData(res);
    } catch (err) {
      alert(`Audio Overview Error: ${err.message}`);
      setAudioModalOpen(false);
    } finally {
      setAudioLoading(false);
    }
  };

  // Load persistent documents from backend SQLite on initial mount
  useEffect(() => {
    fetchDocuments()
      .then((serverDocs) => {
        if (serverDocs && serverDocs.length > 0) {
          setDocs(serverDocs);
          if (activeDocId !== "all" && !serverDocs.some((d) => d.id === activeDocId)) {
            setActiveDocId("all");
          }
        }
      })
      .catch((err) => console.log("Backend not online yet or empty:", err));
  }, []);

  useEffect(() => save("rag.page", page), [page]);
  useEffect(() => save("rag.settings", settings), [settings]);
  useEffect(() => save("rag.messages", messages), [messages]);
  useEffect(() => save("rag.activeDoc", activeDocId), [activeDocId]);

  const handleUpload = async (file) => {
    const tempId = uid();
    const tempDoc = {
      id: tempId,
      filename: file.name,
      title: file.name,
      size: file.size,
      addedAt: Date.now(),
      status: "indexing",
      chunks: 0,
      figures_count: 0,
    };
    setDocs((prev) => [tempDoc, ...prev]);

    try {
      const data = await uploadDocument(file, {
        chunkSize: settings.chunkSize,
        enableVision: true,
      });

      setDocs((list) =>
        list.map((d) =>
          d.id === tempId
            ? {
                ...d,
                id: data.id,
                title: data.title || file.name,
                status: "indexed",
                chunks_count: data.total_chunks,
                figures_count: data.figures_extracted,
                pages: data.pages,
                added_at: Date.now() / 1000,
                filepath: `/uploads/${data.id}_${file.name}`,
              }
            : d
        )
      );
      setActiveDocId(data.id);
    } catch (err) {
      setDocs((list) =>
        list.map((d) => (d.id === tempId ? { ...d, status: "failed", error: err.message } : d))
      );
    }
  };

  const handleImportArxiv = async (queryOrUrl) => {
    const data = await importArxiv(queryOrUrl);
    const newDoc = {
      id: data.id,
      title: data.title,
      authors: data.authors,
      arxiv_id: data.arxiv_id,
      pages: data.pages,
      chunks_count: data.total_chunks,
      figures_count: data.figures_extracted,
      status: "indexed",
      added_at: Date.now() / 1000,
      filename: `${data.arxiv_id}.pdf`,
    };
    setDocs((prev) => [newDoc, ...prev]);
    setActiveDocId(data.id);
    return data;
  };

  const handleRemove = async (id) => {
    try {
      await deleteDocument(id);
    } catch (e) {
      console.warn("Delete error on server:", e);
    }
    setDocs((list) => list.filter((d) => d.id !== id));
    if (activeDocId === id) setActiveDocId("all");
  };

  const handleClear = async () => {
    try {
      await clearAllDocuments();
    } catch (e) {
      console.warn("Clear error on server:", e);
    }
    setDocs([]);
    setMessages([]);
    setActiveDocId("all");
  };

  const handleCopyBibtex = async (docId) => {
    const bibtex = await getBibtex(docId);
    await navigator.clipboard.writeText(bibtex);
    return bibtex;
  };

  const handleCompare = async (docIds) => {
    return await comparePapers(docIds);
  };

  const activeDoc =
    activeDocId === "all"
      ? null
      : docs.find((d) => d.id === activeDocId && d.status === "indexed") || null;

  const handleSend = async (text) => {
    setMessages((m) => [...m, { id: uid(), role: "user", text, time: Date.now() }]);
    setLoading(true);

    // Map UI model setting to API model parameter
    let modelName = "gemini-3.1-flash-lite";
    if (settings.llm && settings.llm.includes("2.5")) modelName = "gemini-2.5-flash";
    else if (settings.llm && settings.llm.includes("Preview")) modelName = "gemini-3.1-flash-lite-preview";

    try {
      const data = await askQuestion(text, {
        docId: activeDocId === "all" ? null : activeDocId,
        topK: settings.topK,
        enableReranker: settings.enableReranker !== false,
        enableHybrid: !settings.vectorDb.includes("Dense FAISS Only"),
        modelName: modelName,
      });

      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          text: data.answer,
          context: data.context,
          figures: data.figures || [],
          docName: activeDoc ? activeDoc.title || activeDoc.filename : "All Papers",
          doc_id: data.doc_id,
          time: Date.now(),
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          error: true,
          text: `Couldn't get an answer: ${err.message}`,
          time: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="main">
        {page === "library" && (
          <Library
            docs={docs}
            onUpload={handleUpload}
            onImportArxiv={handleImportArxiv}
            onRemove={handleRemove}
            onCopyBibtex={handleCopyBibtex}
            onCompare={handleCompare}
            onOpenAudio={handleOpenAudio}
            onOpen={(id) => {
              setActiveDocId(id);
              setPage("assistant");
            }}
          />
        )}
        {page === "assistant" && (
          <Assistant
            docs={docs}
            activeDoc={activeDoc}
            activeDocId={activeDocId}
            messages={messages}
            loading={loading}
            onSend={handleSend}
            onSelectDoc={setActiveDocId}
            onOpenAudio={handleOpenAudio}
          />
        )}
        {page === "settings" && (
          <Settings
            settings={settings}
            onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            docs={docs}
            onClear={handleClear}
          />
        )}
      </main>

      <AudioOverviewModal
        isOpen={audioModalOpen}
        onClose={() => setAudioModalOpen(false)}
        data={audioData}
        loading={audioLoading}
        currentDoc={audioDoc}
        onGenerate={() => handleOpenAudio(audioDoc)}
      />
    </div>
  );
}

export default App;
