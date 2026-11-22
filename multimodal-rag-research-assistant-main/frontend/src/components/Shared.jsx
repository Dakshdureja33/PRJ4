import { ImageIcon, PdfIcon } from "./Icons";
import { isImage } from "../utils";

export function FileBadge({ name, size = "md" }) {
  const image = isImage(name);
  const Icon = image ? ImageIcon : PdfIcon;

  return (
    <span className={`file-badge ${image ? "image" : "pdf"} ${size}`}>
      <Icon size={size === "sm" ? 14 : 20} />
    </span>
  );
}

// Minimal markdown rendering for Gemini answers: paragraphs, bullet lists and **bold**.
function renderInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

export function Markdown({ text }) {
  const blocks = [];
  let list = null;

  text.split("\n").forEach((raw) => {
    const line = raw.trim();
    const bullet = line.match(/^([*-]|\d+\.)\s+(.*)$/);

    if (bullet) {
      if (!list) {
        list = [];
        blocks.push({ type: "list", items: list });
      }
      list.push(bullet[2]);
      return;
    }

    list = null;

    if (line) {
      blocks.push({ type: "p", text: line.replace(/^#+\s*/, "") });
    }
  });

  return blocks.map((block, i) =>
    block.type === "list" ? (
      <ul key={i}>
        {block.items.map((item, j) => (
          <li key={j}>{renderInline(item)}</li>
        ))}
      </ul>
    ) : (
      <p key={i}>{renderInline(block.text)}</p>
    )
  );
}
