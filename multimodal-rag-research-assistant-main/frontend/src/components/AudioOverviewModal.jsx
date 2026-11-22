import { useState, useRef, useEffect } from "react";
import {
  CloseIcon,
  HeadphonesIcon,
  PlayIcon,
  PauseIcon,
  VolumeIcon
} from "./Icons";

export function AudioOverviewModal({ isOpen, onClose, data, loading, onGenerate, currentDoc }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  if (!isOpen) return null;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => console.log("Audio play error:", e));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (!duration || Number.isNaN(duration)) {
        setDuration(audioRef.current.duration || 0);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const formatTime = (secs) => {
    if (!secs || Number.isNaN(secs)) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content audio-overview-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <span className="audio-header-icon">
              <HeadphonesIcon size={22} />
            </span>
            <div>
              <h2>Audio Research Overview (AI Podcast)</h2>
              <span className="audio-subtitle">
                NotebookLM-style two-host synthesis • {data?.paper_title || currentDoc?.title || "Academic Paper"}
              </span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body audio-modal-body">
          {loading ? (
            <div className="modal-loading audio-generating-state">
              <div className="audio-pulse-ring">
                <HeadphonesIcon size={32} />
              </div>
              <h3>Synthesizing Deep-Dive Podcast…</h3>
              <p>
                Drafting conversational script between Dr. Alex and Dr. Jordan, analyzing paper figures and benchmarks, and synthesizing dual-voice audio…
              </p>
              <div className="audio-bars-loading">
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
              </div>
            </div>
          ) : !data ? (
            <div className="audio-empty-state">
              <HeadphonesIcon size={40} />
              <h3>No Audio Overview Generated Yet</h3>
              <p>
                Generate an engaging, two-host academic podcast discussing the methodologies, figures, and benchmark results of this paper.
              </p>
              <button className="btn btn-primary" onClick={onGenerate}>
                🎙️ Generate 2-Minute Podcast
              </button>
            </div>
          ) : (
            <div className="audio-player-container">
              {/* Episode Card */}
              <div className="episode-card">
                <div className="episode-info">
                  <span className="episode-tag">EPISODE · RESEARCH DEEP DIVE</span>
                  <h3 className="episode-title">{data.podcast_title}</h3>
                  <p className="episode-summary">{data.summary}</p>
                  <div className="hosts-badge-group">
                    <span className="host-pill alex">
                      <span className="host-dot"></span> Dr. Alex (Lead Host)
                    </span>
                    <span className="host-pill jordan">
                      <span className="host-dot"></span> Dr. Jordan (Technical Co-Host)
                    </span>
                  </div>
                </div>

                {/* Animated Visualizer */}
                <div className={`audio-visualizer ${isPlaying ? "active" : ""}`}>
                  {[30, 60, 90, 45, 75, 100, 50, 80, 65, 95, 40, 85, 55, 70, 90, 60, 40, 80].map((h, idx) => (
                    <span
                      key={idx}
                      className="vis-bar"
                      style={{
                        height: isPlaying ? `${Math.max(15, (h * (0.6 + Math.random() * 0.4)))}%` : "20%",
                        animationDelay: `${idx * 0.08}s`,
                      }}
                    />
                  ))}
                </div>

                {/* Audio Element */}
                {data.audio_url && (
                  <audio
                    ref={audioRef}
                    src={data.audio_url}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                  />
                )}

                {/* Audio Controls Bar */}
                <div className="audio-controls-panel">
                  <div className="timeline-row">
                    <span className="time-label">{formatTime(currentTime)}</span>
                    <input
                      type="range"
                      className="audio-seeker"
                      min={0}
                      max={duration || 100}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                    />
                    <span className="time-label">{formatTime(duration)}</span>
                  </div>

                  <div className="controls-btn-row">
                    <div className="speed-picker">
                      {[1, 1.25, 1.5].map((rate) => (
                        <button
                          key={rate}
                          className={`speed-btn ${playbackRate === rate ? "active" : ""}`}
                          onClick={() => setPlaybackRate(rate)}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>

                    <button className="play-toggle-btn" onClick={togglePlay} title={isPlaying ? "Pause" : "Play"}>
                      {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
                    </button>

                    <div className="audio-extra-actions">
                      {data.audio_url && (
                        <a
                          href={data.audio_url}
                          download={`${data.doc_id}_podcast.wav`}
                          className="btn btn-secondary btn-sm"
                          title="Download WAV file"
                        >
                          Download Audio
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Transcript Section */}
              <div className="transcript-section">
                <h4 className="transcript-header">Episode Script & Dialogue</h4>
                <div className="transcript-turns">
                  {data.dialogue?.map((turn, i) => {
                    const isAlex = (turn.speaker || "").toLowerCase().includes("alex");
                    return (
                      <div key={i} className={`transcript-bubble ${isAlex ? "turn-alex" : "turn-jordan"}`}>
                        <div className="turn-author">
                          <span className={`turn-avatar ${isAlex ? "alex-av" : "jordan-av"}`}>
                            {isAlex ? "A" : "J"}
                          </span>
                          <span className="turn-name">{isAlex ? "Dr. Alex" : "Dr. Jordan"}</span>
                        </div>
                        <p className="turn-text">{turn.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
