import { useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, TrashIcon, ActivityIcon, SparkIcon } from "../components/Icons";
import { checkHealth, runEvaluation } from "../api";
import { FileBadge } from "../components/Shared";

const MODEL_ROWS = [
  {
    key: "llm",
    label: "LLM for Synthesis & Vision",
    hint: "Generates grounded answers and analyzes extracted paper figures.",
    options: ["Gemini 3.1 Flash-Lite (Recommended)", "Gemini 3.1 Flash-Lite Preview", "Gemini 2.5 Flash"],
  },
  {
    key: "embedding",
    label: "Dense Embedding Model",
    hint: "384-dimensional dense semantic vectors.",
    options: ["Sentence Transformers (all-MiniLM-L6-v2)"],
  },
  {
    key: "vectorDb",
    label: "Retrieval Architecture",
    hint: "Reciprocal Rank Fusion combining FAISS and BM25Okapi.",
    options: ["Hybrid (BM25 + FAISS with RRF)", "Dense FAISS Only"],
  },
];

const SLIDERS = [
  { key: "topK", label: "Top-K Chunks", hint: "Number of relevant chunks passed to synthesis.", min: 1, max: 20, step: 1 },
  { key: "chunkSize", label: "Chunk Size (characters)", hint: "Target chunk size used during PDF splitting.", min: 128, max: 2048, step: 64 },
];

function Slider({ label, hint, min, max, step, value, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      <div className="setting-control">
        <div className="slider-line">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            style={{ "--pct": `${pct}%` }}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <input
            type="number"
            className="num"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
            }}
          />
        </div>
        <span className="hint">{hint}</span>
      </div>
    </div>
  );
}

function Settings({ settings, onChange, docs, onClear }) {
  const [online, setOnline] = useState(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalResults, setEvalResults] = useState(null);

  useEffect(() => {
    let alive = true;
    const ping = () => checkHealth().then((ok) => alive && setOnline(ok));
    ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const total = docs.length;
  const indexed = docs.filter((d) => d.status === "indexed").length;
  const progress = total ? Math.round((indexed / total) * 100) : 100;
  const ringStyle = { "--p": progress };

  const status = online === null ? "checking" : online ? "ok" : "down";
  const health = [
    { label: "Gemini 2.5 API", ok: "Connected" },
    { label: "Sentence-Transformers (MiniLM)", ok: "Ready" },
    { label: "Persistent FAISS & SQLite", ok: "Ready" },
    { label: "BM25 Keyword Engine", ok: "Indexed" },
    { label: "Cross-Encoder Reranker", ok: settings.enableReranker !== false ? "Active" : "Disabled" },
  ];

  const handleRunBenchmark = async () => {
    if (!indexed) {
      alert("Please index at least one research paper before running the benchmark.");
      return;
    }
    setEvalLoading(true);
    try {
      const res = await runEvaluation();
      setEvalResults(res);
    } catch (err) {
      alert(`Benchmark error: ${err.message}`);
    } finally {
      setEvalLoading(false);
    }
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>System Configuration & Evaluation</h1>
          <p className="subtitle">
            Tune hybrid retrieval parameters, configure neural reranking, and run academic
            RAG benchmarks for your project defense.
          </p>
        </div>
      </header>

      <div className="settings-block">
        <h2 className="section-title">Model & Neural Architecture</h2>
        {MODEL_ROWS.map((row) => (
          <div className="setting-row" key={row.key}>
            <span className="setting-label">{row.label}</span>
            <div className="setting-control">
              <label className="select">
                <select
                  value={settings[row.key]}
                  onChange={(e) => onChange({ [row.key]: e.target.value })}
                >
                  {row.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <ChevronDownIcon size={16} />
              </label>
              <span className="hint">{row.hint}</span>
            </div>
          </div>
        ))}

        <div className="setting-row">
          <span className="setting-label">Cross-Encoder Reranker</span>
          <div className="setting-control">
            <label className="checkbox-toggle">
              <input
                type="checkbox"
                checked={settings.enableReranker !== false}
                onChange={(e) => onChange({ enableReranker: e.target.checked })}
              />
              <span>Enable `cross-encoder/ms-marco-MiniLM-L-6-v2` re-scoring</span>
            </label>
            <span className="hint">
              Re-scores top candidate chunks to eliminate spurious false-positive matches.
            </span>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <h2 className="section-title">Retrieval Hyperparameters</h2>
        {SLIDERS.map((s) => (
          <Slider
            key={s.key}
            {...s}
            value={settings[s.key]}
            onChange={(v) => onChange({ [s.key]: v })}
          />
        ))}
      </div>

      {/* Academic Evaluation Benchmark Section */}
      <div className="settings-block benchmark-block">
        <div className="benchmark-header">
          <div>
            <h2 className="section-title">Academic RAG Triad Benchmark Suite</h2>
            <p className="hint">
              Runs automated scientific evaluation measuring Faithfulness (hallucination resistance),
              Answer Relevance, and Retrieval Precision.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleRunBenchmark}
            disabled={evalLoading || !indexed}
          >
            <ActivityIcon size={16} />
            {evalLoading ? "Running Benchmark Queries…" : "Run Evaluation Benchmark"}
          </button>
        </div>

        {evalResults && (
          <div className="eval-results-card">
            <h3>Evaluation Results: {evalResults.paper_evaluated}</h3>
            <div className="eval-metrics-grid">
              <div className="metric-box">
                <span className="metric-val">
                  {(evalResults.summary_metrics.avg_faithfulness * 100).toFixed(0)}%
                </span>
                <span className="metric-lbl">Faithfulness Score</span>
                <small className="hint">Absence of hallucinations</small>
              </div>
              <div className="metric-box">
                <span className="metric-val">
                  {(evalResults.summary_metrics.avg_answer_relevance * 100).toFixed(0)}%
                </span>
                <span className="metric-lbl">Answer Relevance</span>
                <small className="hint">Direct query alignment</small>
              </div>
              <div className="metric-box">
                <span className="metric-val">
                  {(evalResults.summary_metrics.avg_context_precision * 100).toFixed(0)}%
                </span>
                <span className="metric-lbl">Context Precision@K</span>
                <small className="hint">Relevance of retrieved chunks</small>
              </div>
            </div>

            <table className="eval-table">
              <thead>
                <tr>
                  <th>Query Category</th>
                  <th>Faithfulness</th>
                  <th>Relevance</th>
                  <th>Precision</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {evalResults.detailed_queries.map((q, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{q.type}</strong>
                      <br />
                      <small className="hint">{q.query}</small>
                    </td>
                    <td>{(q.faithfulness * 100).toFixed(0)}%</td>
                    <td>{(q.relevance * 100).toFixed(0)}%</td>
                    <td>{(q.precision * 100).toFixed(0)}%</td>
                    <td>{q.latency_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="status-grid">
        <div className="card status-card">
          <h3>Indexing Status</h3>
          <div className="index-status">
            <div className="ring" style={ringStyle}>
              <span>{progress}%</span>
            </div>
            <div>
              <strong className="ok-text">
                {progress === 100 ? "Indexing Complete" : "Indexing…"}
              </strong>
              <p className="hint">
                {total
                  ? progress === 100
                    ? "All documents are indexed and ready to use."
                    : `${indexed} of ${total} documents indexed.`
                  : "No documents in your library yet."}
              </p>
            </div>
          </div>
          <ul className="index-list">
            {docs.map((d) => (
              <li key={d.id}>
                <FileBadge name={d.filename || d.name} size="sm" />
                <span className="index-name">{d.title || d.filename || d.name}</span>
                <span className="index-chunks">
                  {d.status === "indexed" ? `${d.chunks_count || d.chunks} chunks` : d.status}
                </span>
                <span className={`check ${d.status}`}>
                  {d.status === "indexed" && <CheckIcon size={10} strokeWidth={3} />}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card status-card">
          <h3>System Health</h3>
          <ul className="health-list">
            {health.map((h) => (
              <li key={h.label}>
                <span className={`dot ${status}`} />
                <span>{h.label}</span>
                <span className={`health-state ${status}`}>
                  {status === "ok" ? h.ok : status === "down" ? "Offline" : "Checking…"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card danger-card">
          <TrashIcon size={18} className="danger-icon" />
          <div>
            <strong>Clear Entire Corpus</strong>
            <p className="hint">Wipes persistent database, figures, and vector stores.</p>
          </div>
          <button
            className="btn btn-danger"
            disabled={!total}
            onClick={() => {
              if (window.confirm("Remove all documents and reset vector indexes?")) onClear();
            }}
          >
            Clear All
          </button>
        </div>
      </div>
    </section>
  );
}

export default Settings;
