import {
  BookIcon,
  ChatIcon,
  GearIcon,
  LibraryIcon,
  NetworkIcon,
  QuoteChatIcon,
  SlidersIcon,
} from "./Icons";

const NAV = [
  { id: "library", label: "Library", icon: LibraryIcon },
  { id: "assistant", label: "Assistant", icon: ChatIcon },
  { id: "settings", label: "Settings", icon: GearIcon },
];

const FOOTER = {
  library: { text: "Turn your documents into conversations.", icon: QuoteChatIcon },
  assistant: { text: "Grounded by your research.", icon: NetworkIcon },
  settings: { text: "Customise for your workflow.", icon: SlidersIcon },
};

function Sidebar({ page, onNavigate }) {
  const footer = FOOTER[page];
  const FooterIcon = footer.icon;

  return (
    <aside className="sidebar">
      <div className="brand">
        <BookIcon size={26} className="brand-icon" />
        <span>Multimodal RAG</span>
      </div>

      <nav className="nav">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${page === id ? "active" : ""}`}
            onClick={() => onNavigate(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p>{footer.text}</p>
        <FooterIcon size={18} />
      </div>
    </aside>
  );
}

export default Sidebar;
