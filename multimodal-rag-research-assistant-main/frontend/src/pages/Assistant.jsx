import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandIcon,
  MicIcon,
  MinusIcon,
  PlusIcon,
  SendIcon,
  SparkIcon,
  CloseIcon,
  ExternalLinkIcon,
  HeadphonesIcon
} from "../components/Icons";
import { FileBadge, Markdown } from "../components/Shared";
import { formatTime, isImage } from "../utils";

const SUGGESTIONS = [
  "Summarize the core methodology and contributions",
  "Explain Figure 1 / Figure 2 in detail",
  "What are the baseline benchmark results reported?",
  "What are the main limitations identified by the authors?"
];
const ZOOM_STEPS = [50, 75, 100, 125, 150, 200];

const SpeechRecognition =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

function passagesFrom(context) {
  if (!context) return [];
  return context
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 30);
}

function excerpt(text, max = 240) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function DocViewer({ docs, activeDoc, activeDocId, targetPage, onSelectDoc, onOpenAudio }) {
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const cardRef = useRef(null);
  const indexed = docs.filter((d) => d.status === "indexed");

  // Synchronize targetPage when a citation is clicked
  useEffect(() => {
    if (targetPage && targetPage >= 1) {
      setCurrentPage(targetPage);
    }
  }, [targetPage]);

  // Reset to page 1 when switching documents
  useEffect(() => {
    setCurrentPage(1);
  }, [activeDocId]);

  const stepZoom = (dir) => {
    const i = ZOOM_STEPS.indexOf(zoom) + dir;
    if (i >= 0 && i < ZOOM_STEPS.length) setZoom(ZOOM_STEPS[i]);
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else cardRef.current?.requestFullscreen?.();
  };

  const totalPages = activeDoc?.pages || 1;

  // Determine file URL: if uploaded on backend, use /uploads/..., else fallback
  const pdfUrl = activeDoc
    ? activeDoc.filepath && activeDoc.filepath.includes("uploads/")
      ? `/uploads/${activeDoc.filepath.split("uploads/").pop()}`
      : activeDoc.filename
      ? `/uploads/${activeDoc.filename}`
      : null
    : null;

  let body;
  if (activeDocId === "all") {
    body = (
      <div className="viewer-empty">
        <SparkIcon size={32} />
        <p>
          <strong>Multi-Document Library Mode Active</strong>
          <br />
          Questions will search across all indexed research papers simultaneously.
        </p>
      </div>
    );
  } else if (!activeDoc) {
    body = <div className="viewer-empty">Upload a document in the Library to preview it here.</div>;
  } else if (isImage(activeDoc.name || activeDoc.filename)) {
    body = (
      <div className="viewer-scroll">
        <img
          src={pdfUrl}
          alt={activeDoc.title || activeDoc.filename}
          className="viewer-image"
          style={{ width: `${zoom}%` }}
        />
      </div>
    );
  } else if (activeDoc?.id) {
    // Render high-res crisp page image directly (works in Safari, Chrome, Firefox, Mobile)
    const pageImgUrl = `/api/documents/${activeDoc.id}/page/${currentPage}`;
    body = (
      <div className="viewer-scroll">
        <img
          key={`${activeDoc.id}-page-${currentPage}`}
          src={pageImgUrl}
          alt={`Page ${currentPage} of ${activeDoc.title || activeDoc.filename}`}
          className="viewer-pdf-page"
          style={{ width: `${zoom}%`, transition: "width 0.15s ease" }}
        />
      </div>
    );
  } else {
    body = (
      <div className="viewer-empty">
        Document preview is ready. Re-upload <strong>{activeDoc.filename}</strong> if the local cache expired.
      </div>
    );
  }

  return (
    <div className="viewer card" ref={cardRef}>
      <div className="viewer-bar">
        <div className="menu-wrap viewer-title">
          <button
            className="viewer-picker"
            onClick={() => setPickerOpen((o) => !o)}
          >
            {activeDoc ? <FileBadge name={activeDoc.filename || activeDoc.name} size="sm" /> : <SparkIcon size={16} />}
            <span>
              <strong>
                {activeDocId === "all"
                  ? "All Library Documents (Multi-Paper)"
                  : activeDoc
                  ? activeDoc.title || activeDoc.filename || activeDoc.name
                  : "No document"}
              </strong>
              <small>
                {activeDocId === "all"
                  ? `${indexed.length} papers indexed`
                  : activeDoc?.pages
                  ? `${activeDoc.pages} pages • ${activeDoc.figures_count || 0} figures`
                  : "—"}
              </small>
            </span>
            <ChevronDownIcon size={14} />
          </button>
          {pickerOpen && (
            <div className="menu menu-left">
              <button
                className={activeDocId === "all" ? "active-item" : ""}
                onClick={() => {
                  onSelectDoc("all");
                  setPickerOpen(false);
                }}
              >
                🌐 All Documents (Whole Library)
              </button>
              {indexed.map((d) => (
                <button
                  key={d.id}
                  className={activeDocId === d.id ? "active-item" : ""}
                  onClick={() => {
                    onSelectDoc(d.id);
                    setPickerOpen(false);
                  }}
                >
                  📄 {d.title || d.filename}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Page navigation controls */}
        {activeDoc && totalPages > 1 && (
          <div className="page-nav">
            <button
              className="icon-btn"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              title="Previous Page"
            >
              <ChevronLeftIcon size={14} />
            </button>
            <span className="page-nav-text">
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="icon-btn"
              aria-label="Next page"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              title="Next Page"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>
        )}

        <div className="zoom">
          <button className="icon-btn" aria-label="Zoom out" onClick={() => stepZoom(-1)}>
            <MinusIcon size={14} />
          </button>
          <span>{zoom}%</span>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => stepZoom(1)}>
            <PlusIcon size={14} />
          </button>
        </div>
        {activeDoc && onOpenAudio && (
          <button
            className="btn btn-secondary btn-sm audio-bar-btn"
            title="Listen to NotebookLM Audio Overview Podcast"
            onClick={() => onOpenAudio(activeDoc)}
          >
            <HeadphonesIcon size={13} />
            <span>Podcast</span>
          </button>
        )}
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="icon-btn"
            title="Open raw PDF in new browser tab"
          >
            <ExternalLinkIcon size={15} />
          </a>
        )}
        <button className="icon-btn" aria-label="Fullscreen" onClick={fullscreen}>
          <ExpandIcon size={16} />
        </button>
      </div>
      <div className="viewer-page">{body}</div>
    </div>
  );
}

function AssistantMessage({ msg, onCitationClick, onImageClick }) {
  const [open, setOpen] = useState(false);
  const passages = passagesFrom(msg.context);

  if (msg.error) {
    return (
      <div className="msg msg-assistant">
        <span className="assistant-avatar">
          <SparkIcon size={18} />
        </span>
        <div className="msg-body">
          <p className="msg-error">{msg.text}</p>
        </div>
      </div>
    );
  }

  // Parse [Page X] or [Page X, ...] into clickable citation pills
  const renderCitationsInText = (text) => {
    return text;
  };

  return (
    <div className="msg msg-assistant">
      <span className="assistant-avatar">
        <SparkIcon size={18} />
      </span>
      <div className="msg-body">
        <div className="answer">
          <Markdown text={msg.text} />
        </div>

        {/* Multimodal Figures & Diagrams extracted and retrieved */}
        {msg.figures && msg.figures.length > 0 && (
          <div className="retrieved-figures-section">
            <div className="figures-header">
              <SparkIcon size={14} />
              <span>Extracted Visual Figures & Tables</span>
            </div>
            <div className="figures-grid">
              {msg.figures.map((fig, idx) => (
                <div
                  key={idx}
                  className="figure-card"
                  onClick={() => onImageClick(fig)}
                  title="Click to enlarge"
                >
                  <img src={fig.image_url} alt={`Figure on page ${fig.page}`} />
                  <div className="figure-info">
                    <span className="figure-badge">Page {fig.page}</span>
                    <span className="figure-summary">{excerpt(fig.summary, 90)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg.docName && (
          <span className="cite-chip">
            <FileBadge name={msg.docName} size="sm" />
            {msg.docName}
          </span>
        )}

        {passages.length > 0 && (
          <div className="related">
            <button className="related-toggle" onClick={() => setOpen((o) => !o)}>
              <ChevronDownIcon size={14} className={open ? "" : "rot"} />
              Retrieved source passages ({passages.length})
            </button>
            {open && (
              <ul>
                {passages.map((p, i) => {
                  const match = p.match(/\[Page (\d+)\]/i);
                  const pageNum = match ? parseInt(match[1], 10) : null;
                  return (
                    <li key={i} title={p}>
                      <FileBadge name={msg.docName || "doc"} size="sm" />
                      <div className="passage-content">
                        {pageNum && (
                          <button
                            className="citation-pill"
                            onClick={() => onCitationClick(pageNum, msg.doc_id)}
                          >
                            Page {pageNum}
                          </button>
                        )}
                        <span className="related-snippet">{excerpt(p, 160)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageModal({ figure, onClose }) {
  if (!figure) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content image-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <SparkIcon size={18} />
            <h2>Figure from Page {figure.page}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="image-modal-body">
          <img src={figure.image_url} alt="Enlarged figure" className="modal-figure-img" />
          <p className="image-caption-text">{figure.summary}</p>
        </div>
      </div>
    </div>
  );
}

function Assistant({
  docs,
  activeDoc,
  activeDocId,
  messages,
  loading,
  onSend,
  onSelectDoc,
  onOpenAudio
}) {
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [targetPage, setTargetPage] = useState(null);
  const [modalFigure, setModalFigure] = useState(null);
  const threadRef = useRef(null);
  const hasIndexed = docs.some((d) => d.status === "indexed");

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = (text) => {
    const q = text.trim();
    if (!q || loading) return;
    onSend(q);
    setDraft("");
  };

  const handleCitationClick = (pageNum, docId) => {
    if (docId && docId !== activeDocId && docId !== "all") {
      onSelectDoc(docId);
    }
    setTargetPage(pageNum);
  };

  const dictate = () => {
    if (!SpeechRecognition || listening) return;
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.onresult = (e) => setDraft((d) => `${d} ${e.results[0][0].transcript}`.trim());
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  return (
    <section className="page page-assistant">
      <header className="page-header">
        <div>
          <h1>Multimodal Research Assistant</h1>
          <p className="subtitle">
            Query across your library or specific papers. Get scientifically grounded answers,
            visual architecture diagrams, and page citations.
          </p>
        </div>
        <span className="grounded-pill">
          <span className="dot" /> Hybrid RAG Grounded
        </span>
      </header>

      <div className="assistant-grid">
        <DocViewer
          docs={docs}
          activeDoc={activeDoc}
          activeDocId={activeDocId}
          targetPage={targetPage}
          onSelectDoc={onSelectDoc}
          onOpenAudio={onOpenAudio}
        />

        <div className="chat card">
          <div className="thread" ref={threadRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <span className="assistant-avatar lg">
                  <SparkIcon size={24} />
                </span>
                <strong>Scientific Literature Assistant</strong>
                <span>
                  {hasIndexed
                    ? "Answers are synthesized using Hybrid Search (BM25 + FAISS) and Cross-Encoder reranking."
                    : "Upload an academic paper in the Library or import from ArXiv to get started."}
                </span>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="msg msg-user">
                  <div className="user-bubble">
                    <span className="user-avatar">You</span>
                    <span>{m.text}</span>
                  </div>
                  <time>{formatTime(m.time)}</time>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  msg={m}
                  onCitationClick={handleCitationClick}
                  onImageClick={setModalFigure}
                />
              )
            )}

            {loading && (
              <div className="msg msg-assistant">
                <span className="assistant-avatar">
                  <SparkIcon size={18} />
                </span>
                <div className="typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              placeholder={
                activeDocId === "all"
                  ? "Ask across all papers in library..."
                  : `Ask about ${activeDoc ? activeDoc.title || activeDoc.filename : "this paper"}...`
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!hasIndexed}
            />
            {SpeechRecognition && (
              <button
                type="button"
                className={`icon-btn ${listening ? "listening" : ""}`}
                aria-label="Dictate"
                onClick={dictate}
              >
                <MicIcon size={16} />
              </button>
            )}
            <button
              type="submit"
              className="send-btn"
              aria-label="Send"
              disabled={!draft.trim() || loading || !hasIndexed}
            >
              <SendIcon size={16} />
            </button>
          </form>

          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={loading || !hasIndexed}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ImageModal figure={modalFigure} onClose={() => setModalFigure(null)} />
    </section>
  );
}

export default Assistant;
