export function isImage(name) {
  return /\.(png|jpe?g)$/i.test(name);
}

export function timeAgo(timestamp, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));

  if (seconds < 45) return "just now";

  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  for (const [unit, secs] of units) {
    const value = Math.floor(seconds / secs);
    if (value >= 1) return `${value} ${unit}${value > 1 ? "s" : ""} ago`;
  }

  return "just now";
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
