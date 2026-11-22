import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  CloudUploadIcon,
  CubeIcon,
  DotsIcon,
  LibraryIcon,
  PlusIcon,
  SearchIcon,
  ArxivIcon,
  ColumnsIcon,
  ClipboardIcon,
  CheckIcon,
  CloseIcon,
  SparkIcon,
  HeadphonesIcon
} from "../components/Icons";
import { FileBadge, Markdown } from "../components/Shared";
import { timeAgo } from "../utils";

const ACCEPT = ".pdf,.png,.jpg,.jpeg";

function StatusPill({ doc }) {
  if (doc.status === "indexing") {
    return <span className="pill pill-pending">Indexing…</span>;
  }
  if (doc.status === "failed") {
    return (
      <span className="pill pill-failed" title={doc.error}>
        Failed
      </span>
    );
  }
  return (
    <span className="pill pill-success">
      <span className="pill-plus">+</span> Indexed
    </span>
  );
}

function DocRow({ doc, selected, onToggleSelect, onOpen, onRemove, onCopyBibtex, onOpenAudio }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const chunks = doc.status === "indexed" ? ` • ${doc.chunks_count || doc.chunks || 0} chunks` : "";
  const figures = doc.figures_count ? ` • ${doc.figures_count} figures` : "";

  const handleCopyBib = async () => {
    setMenuOpen(false);
    await onCopyBibtex(doc.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`doc-row ${selected ? "selected-row" : ""}`}>
      <input
        type="checkbox"
        className="doc-checkbox"
        checked={selected}
        onChange={() => onToggleSelect(doc.id)}
        disabled={doc.status !== "indexed"}
        title="Select for Paper Comparison"
      />
      <FileBadge name={doc.filename || doc.name} />
      <div className="doc-info">
        <span className="doc-name">{doc.title || doc.filename || doc.name}</span>
        <span className="doc-meta">
          {doc.authors ? `${doc.authors} • ` : ""}
          Added {timeAgo(doc.added_at ? doc.added_at * 1000 : doc.addedAt)}
          {chunks}
          {figures}
        </span>
      </div>
      <StatusPill doc={doc} />
      {doc.status === "indexed" && onOpenAudio && (
        <button
          className="btn-podcast-pill"
          title="Listen to NotebookLM-style Audio Overview Podcast"
          onClick={() => onOpenAudio(doc)}
        >
          <HeadphonesIcon size={13} />
          <span>Podcast</span>
        </button>
      )}
      <div className="menu-wrap" ref={menuRef}>
        <button
          className="icon-btn"
          aria-label="Document actions"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <DotsIcon size={16} />
        </button>
        {menuOpen && (
          <div className="menu">
            <button
              disabled={doc.status !== "indexed"}
              onClick={() => {
                setMenuOpen(false);
                onOpen(doc.id);
              }}
            >
              Open in Assistant
            </button>
            {onOpenAudio && (
              <button
                disabled={doc.status !== "indexed"}
                onClick={() => {
                  setMenuOpen(false);
                  onOpenAudio(doc);
                }}
              >
                🎙️ Audio Overview
              </button>
            )}
            <button disabled={doc.status !== "indexed"} onClick={handleCopyBib}>
              {copied ? "Copied!" : "Copy BibTeX"}
            </button>
            <button
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                onRemove(doc.id);
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CompareModal({ isOpen, onClose, comparisonResult, loading }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <ColumnsIcon size={20} />
            <h2>Cross-Paper Comparative Synthesis</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="modal-loading">
              <span className="assistant-avatar">
                <SparkIcon size={24} />
              </span>
              <p>Analyzing papers, methodologies, and benchmarks across documents…</p>
            </div>
          ) : comparisonResult ? (
            <div className="comparison-content">
              <Markdown text={comparisonResult.comparison_markdown} />
            </div>
          ) : (
            <p>Select at least 2 indexed papers to generate a comparative analysis.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Library({ docs, onUpload, onImportArxiv, onOpen, onRemove, onCopyBibtex, onCompare, onOpenAudio }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [arxivQuery, setArxivQuery] = useState("");
  const [arxivLoading, setArxivLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [comparing, setComparing] = useState(false);

  const indexed = docs.filter((d) => d.status === "indexed");
  const totalChunks = indexed.reduce((sum, d) => sum + (d.chunks_count || d.chunks || 0), 0);
  const totalFigures = indexed.reduce((sum, d) => sum + (d.figures_count || 0), 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = docs.filter((d) => {
      const name = d.title || d.filename || d.name || "";
      return name.toLowerCase().includes(q);
    });
    if (sort === "name") return [...list].sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
    if (sort === "chunks") return [...list].sort((a, b) => (b.chunks_count || b.chunks || 0) - (a.chunks_count || a.chunks || 0));
    return [...list].sort((a, b) => (b.added_at || b.addedAt || 0) - (a.added_at || a.addedAt || 0));
  }, [docs, query, sort]);

  const handleFiles = (files) => {
    Array.from(files || []).forEach(onUpload);
  };

  const handleArxivSubmit = async (e) => {
    e.preventDefault();
    if (!arxivQuery.trim() || arxivLoading) return;
    setArxivLoading(true);
    try {
      await onImportArxiv(arxivQuery.trim());
      setArxivQuery("");
    } catch (err) {
      alert(`ArXiv Import Failed: ${err.message}`);
    } finally {
      setArxivLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCompareClick = async () => {
    if (selectedIds.length < 2) return;
    setCompareModalOpen(true);
    setComparing(true);
    try {
      const res = await onCompare(selectedIds);
      setComparisonResult(res);
    } catch (err) {
      alert(`Comparison failed: ${err.message}`);
      setCompareModalOpen(false);
    } finally {
      setComparing(false);
    }
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Research Corpus Library</h1>
          <p className="subtitle">
            Upload research papers (PDFs) or import from ArXiv. Text, architecture diagrams,
            and tables are extracted and indexed into multimodal vector storage.
          </p>
        </div>
        <div className="header-actions">
          {selectedIds.length >= 2 && (
            <button className="btn btn-compare" onClick={handleCompareClick}>
              <ColumnsIcon size={16} /> Compare Selected ({selectedIds.length})
            </button>
          )}
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
            <PlusIcon size={16} /> Upload Papers
          </button>
        </div>
      </header>

      {/* ArXiv One-Click Import Bar */}
      <form className="arxiv-bar" onSubmit={handleArxivSubmit}>
        <div className="arxiv-icon-wrap">
          <ArxivIcon size={18} />
        </div>
        <input
          placeholder="Import paper from ArXiv by ID or URL (e.g. 2312.00752 or https://arxiv.org/abs/...)"
          value={arxivQuery}
          onChange={(e) => setArxivQuery(e.target.value)}
          disabled={arxivLoading}
        />
        <button type="submit" className="btn btn-secondary" disabled={!arxivQuery.trim() || arxivLoading}>
          {arxivLoading ? "Importing & Indexing…" : "Import Paper"}
        </button>
      </form>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <CloudUploadIcon size={36} className="dropzone-icon" />
        <strong>Drop research papers here or click to upload</strong>
        <span>PDF papers automatically extract figures, architecture diagrams, and tables</span>
      </div>

      <div className="stats">
        <div className="stat-card">
          <span className="stat-icon">
            <LibraryIcon size={22} />
          </span>
          <div>
            <div className="stat-value">{indexed.length}</div>
            <div className="stat-label">Papers Indexed</div>
            <div className="stat-hint">Active multi-document corpus</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <CubeIcon size={22} />
          </span>
          <div>
            <div className="stat-value">{totalChunks}</div>
            <div className="stat-label">Vector Chunks</div>
            <div className="stat-hint">Hybrid FAISS & BM25 index</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon stat-icon-figures">
            <SparkIcon size={22} />
          </span>
          <div>
            <div className="stat-value">{totalFigures}</div>
            <div className="stat-label">Extracted Figures & Tables</div>
            <div className="stat-hint">Gemini Vision enriched diagrams</div>
          </div>
        </div>
      </div>

      <h2 className="section-title">Indexed Documents</h2>

      <div className="toolbar">
        <label className="search">
          <SearchIcon size={16} />
          <input
            placeholder="Search papers by title or filename..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="select select-sm">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Last uploaded</option>
            <option value="name">Title</option>
            <option value="chunks">Most chunks</option>
          </select>
          <ChevronDownIcon size={16} />
        </label>
      </div>

      <div className="doc-list">
        {visible.map((doc) => (
          <DocRow
            key={doc.id}
            doc={doc}
            selected={selectedIds.includes(doc.id)}
            onToggleSelect={toggleSelect}
            onOpen={onOpen}
            onRemove={onRemove}
            onCopyBibtex={onCopyBibtex}
            onOpenAudio={onOpenAudio}
          />
        ))}
        {visible.length === 0 && (
          <div className="empty">
            {docs.length ? "No papers match your search." : "No documents yet. Upload a PDF or import an ArXiv paper above."}
          </div>
        )}
      </div>

      <CompareModal
        isOpen={compareModalOpen}
        onClose={() => setCompareModalOpen(false)}
        comparisonResult={comparisonResult}
        loading={comparing}
      />
    </section>
  );
}

export default Library;
