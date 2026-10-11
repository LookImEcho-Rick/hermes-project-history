/* Local dashboard plugin. React and authenticated requests come from the host SDK. */
interface SourceSummary {
  id: string; kind: string; title: string; location: string; section: string;
  line: number; date: number; excerpt: string;
}
interface Source extends SourceSummary {
  format: string; content?: string; current_date?: number; selected_message?: number;
  messages?: { id: number; role: string; content: string; timestamp: number }[];
  context_note?: string;
}
interface SearchResult {
  results: SourceSummary[];
  status: { updated: string | null; sources: number; warnings: string[]; counts: Record<string, number> };
  terms: string[];
}
interface Host {
  React: typeof import("react");
  fetchJSON: <T>(url: string, init?: RequestInit) => Promise<T>;
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  sdkVersion: string;
}
const window = globalThis.window as Window & {
  __HERMES_PLUGIN_SDK__?: Host;
  __HERMES_PLUGINS__?: { register: (name: string, component: import("react").ComponentType<any>) => void; registerSlot: (name: string, slot: string, component: import("react").ComponentType<any>) => void };
  __HERMES_BASE_PATH__?: string;
};
const host = window.__HERMES_PLUGIN_SDK__;
if (!host || !/^1\./.test(host.sdkVersion) || !host.fetchJSON || !host.authedFetch || !window.__HERMES_PLUGINS__) {
  throw new Error("Project history: dashboard plugin SDK is incompatible. Run the Local AI compatibility check.");
}
const React = host.React;
const { useState, useEffect, useRef } = React;
const base = window.__HERMES_BASE_PATH__ || "";
const api = `${base}/api/plugins/project-history`;
const eventName = "local-ai:open-source";
const json = host.fetchJSON;

function date(value: number) {
  return value ? new Date(value * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable";
}
function openSource(id: string, query = "") {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { id, query } }));
}
function highlighted(text: string, query: string) {
  const terms = (query.match(/[\p{L}\p{N}_]+/gu) || []).filter(t => t.length > 1).slice(0, 12);
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : part);
}
function safeExternal(href: string) {
  try { return ["http:", "https:"].includes(new URL(href).protocol); } catch { return false; }
}

function LocalImage({ source, href, alt, endpoint }: { source: string; href: string; alt: string; endpoint?: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    let objectUrl = "";
    setUrl(""); setError("");
    host!.authedFetch(endpoint || `${api}/image/${source}?href=${encodeURIComponent(href)}`)
      .then(async response => {
        if (!response.ok) throw new Error("Image is unavailable or outside the approved project folders.");
        const blob = await response.blob();
        if (live) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
      }).catch(e => { if (live) setError(String(e.message)); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, href, endpoint]);
  useEffect(() => {
    if (!zoom) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); setZoom(false); button.current?.focus(); }
      if (event.key === "Tab") { event.preventDefault(); document.getElementById("ph-image-close")?.focus(); }
    };
    window.addEventListener("keydown", key, true);
    document.getElementById("ph-image-close")?.focus();
    return () => window.removeEventListener("keydown", key, true);
  }, [zoom]);
  if (error) return <span className="ph-notice">{alt || "Image"}: {error}</span>;
  if (!url) return <span className="ph-muted">Loading image…</span>;
  return <>
    <button ref={button} type="button" className="ph-image-button" onClick={() => setZoom(true)} aria-label={`Enlarge ${alt || "image"}`}><img src={url} alt={alt} loading="lazy" /></button>
    {zoom && <div className="ph-image-zoom" role="dialog" aria-modal="true" aria-label={alt || "Image preview"}>
      <button type="button" id="ph-image-close" onClick={() => { setZoom(false); button.current?.focus(); }}>Close image</button>
      <img src={url} alt={alt} />
    </div>}
  </>;
}

function inline(text: string, source: string, query: string): import("react").ReactNode[] {
  // HTML is always text. Links/images are explicitly gated, never raw innerHTML.
  const pattern = /(!?\[[^\]]*\]\([^\n]*?\)|`[^`]+`|\*\*[^*]+\*\*)/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={index}>{highlighted(part.slice(2, -2), query)}</strong>;
    const link = /^(!?)\[([^\]]*)\]\((.*?)\)$/.exec(part);
    if (!link) return <React.Fragment key={index}>{highlighted(part, query)}</React.Fragment>;
    const [, image, label, target] = link;
    const href = target.trim().replace(/^<|>$/g, "");
    if (image) return <LocalImage key={index} source={source} href={href} alt={label} />;
    if (safeExternal(href)) {
      const url = new URL(href);
      if (url.origin === window.location.origin && url.pathname === `${base}/project-history` && /^[a-f0-9]{32}$/.test(url.searchParams.get("source") || "")) {
        return <a key={index} href={href} onClick={e => { e.preventDefault(); openSource(url.searchParams.get("source")!, query); }}>{label}</a>;
      }
      return <a key={index} href={href} target="_blank" rel="noopener noreferrer">{highlighted(label, query)}</a>;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return <span key={index}>{label} (unsupported link)</span>;
    return <button key={index} type="button" className="ph-inline-link" onClick={() => {
      json<{ id: string }>(`${api}/link/${source}?href=${encodeURIComponent(href)}`).then(result => openSource(result.id, query)).catch(e => window.dispatchEvent(new CustomEvent("local-ai:source-error", { detail: String(e.message) })));
    }}>{highlighted(label, query)}</button>;
  });
}

function Markdown({ content, source, query }: { content: string; source: string; query: string }) {
  const lines = content.split("\n");
  const nodes: import("react").ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const number = i + 1;
    if (/^(```|~~~)/.test(line)) {
      const delimiter = line.slice(0, 3);
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith(delimiter)) code.push(lines[i]);
      nodes.push(<pre key={number} data-line={number}><code>{highlighted(code.join("\n"), query)}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { nodes.push(React.createElement(`h${heading[1].length}`, { key: number, "data-line": number }, inline(heading[2], source, query))); continue; }
    if (i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]) && line.includes("|")) {
      const cells = (row: string) => row.replace(/^\s*\||\|\s*$/g, "").split("|").map(cell => cell.trim());
      const headers = cells(line); const rows: string[][] = []; i++;
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) rows.push(cells(lines[++i]));
      nodes.push(<div className="ph-table" key={number} data-line={number}><table><thead><tr>{headers.map((cell, n) => <th key={n}>{inline(cell, source, query)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{row.map((cell, j) => <td key={j}>{inline(cell, source, query)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const startsBlock = (value: string) => /^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>|```|~~~|\|)/.test(value) || /^\s*([-*_])\1\1+\s*$/.test(value);
    if (line.trim() && !/^>/.test(line) && !/^\s*([-*_])\1\1+\s*$/.test(line)) {
      const list = /^\s*(?:[-*+]\s|\d+\.\s)/.test(line);
      while (i + 1 < lines.length && lines[i + 1].trim() && !startsBlock(lines[i + 1])
             && (!list || /^\s{2,}\S/.test(lines[i + 1]))) line += " " + lines[++i].trim();
    }
    if (/^\s*[-*+]\s+/.test(line)) { nodes.push(<div className="ph-list-item" key={number} data-line={number}><span aria-hidden="true">•</span><div>{inline(line.replace(/^\s*[-*+]\s+/, ""), source, query)}</div></div>); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { nodes.push(<div className="ph-list-item" key={number} data-line={number}><span>{line.match(/^\s*(\d+\.)/)![1]}</span><div>{inline(line.replace(/^\s*\d+\.\s+/, ""), source, query)}</div></div>); continue; }
    if (/^>/.test(line)) { nodes.push(<blockquote key={number} data-line={number}>{inline(line.replace(/^>\s?/, ""), source, query)}</blockquote>); continue; }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { nodes.push(<hr key={number} />); continue; }
    nodes.push(line.trim() ? (line.includes("![") ? <div key={number} data-line={number}>{inline(line, source, query)}</div> : <p key={number} data-line={number}>{inline(line, source, query)}</p>) : <div key={number} className="ph-paragraph-space" />);
  }
  return <div className="ph-document">{nodes}</div>;
}

function Search({ compact = false }: { compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const run = async (refresh = false) => {
    const current = ++sequence.current; setLoading(true); setError("");
    try {
      if (refresh) await json(`${api}/refresh`, { method: "POST" });
      const response = await json<SearchResult>(`${api}/search?q=${encodeURIComponent(query)}&kind=${kind}`);
      if (current === sequence.current) setResult(response);
    } catch (e) { if (current === sequence.current) setError(String((e as Error).message)); }
    finally { if (current === sequence.current) setLoading(false); }
  };
  useEffect(() => { void run(); return () => { sequence.current++; }; }, []);
  return <section className={`ph-search ${compact ? "ph-compact" : ""}`} aria-label="Project history search">
    <header><h1>{compact ? "Find a source" : "Project history"}</h1><p>Find the decisions, reports and conversations behind your work.</p></header>
    <form onSubmit={e => { e.preventDefault(); void run(); }}>
      <label htmlFor={compact ? "ph-query-compact" : "ph-query"}>Search your history</label>
      <div className="ph-search-row"><input id={compact ? "ph-query-compact" : "ph-query"} value={query} onChange={e => setQuery(e.target.value)} maxLength={300} placeholder="Try MTP, compression, or backup" /><button type="submit" disabled={loading}>Search</button></div>
      <div className="ph-search-row"><label>Sources <select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All sources</option><option value="notebook">Notebooks</option><option value="report">Reports</option><option value="chat">Past chats</option></select></label><button type="button" disabled={loading} onClick={() => void run(true)}>Refresh history</button></div>
    </form>
    {loading && <p role="status">{result ? "Searching…" : "Preparing your local history…"}</p>}
    {error && <p className="ph-error" role="alert">{error} <button type="button" onClick={() => void run()}>Retry</button></p>}
    {result && <>
      <p className="ph-muted">{result.results.length} shown · {result.status.sources.toLocaleString()} indexed sections and messages · {query ? "Search matches" : "Latest source activity"}</p>
      <p className="ph-muted">Updated {result.status.updated ? new Date(result.status.updated).toLocaleString() : "not yet"}. Report dates reflect file updates; chat dates reflect message times.</p>
      {!!result.status.warnings.length && <details className="ph-notice"><summary>{result.status.warnings.length} indexing notices</summary>{result.status.warnings.map((warning, n) => <p key={n}>{warning}</p>)}</details>}
      {!result.results.length && <p>No matches. Try a shorter phrase or a distinctive name, then refresh if the source is new.</p>}
      <div className="ph-results">{result.results.map(item => <a className="ph-result" key={item.id} href={`${base}/project-history?source=${item.id}&q=${encodeURIComponent(query)}`} onClick={e => { e.preventDefault(); openSource(item.id, query); }}>
        <div className="ph-result-meta"><span>{item.kind === "chat" ? "Past chat" : item.kind === "notebook" ? "Notebook" : "Report"}</span><time>{date(item.date)}</time></div>
        <h2>{highlighted(item.title, query)}</h2><p className="ph-section">{item.section}</p>
        <p>{highlighted(item.excerpt, query)}</p><span className="ph-location">{item.location}{item.line ? ` · line ${item.line}` : ""}</span>
      </a>)}</div>
    </>}
  </section>;
}

function Preview() {
  const [opened, setOpened] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const article = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const last = useRef({ id: "", query: "" });
  const close = () => { sequence.current++; setOpened(false); opener.current?.focus(); };
  const load = async (id: string, term: string) => {
    const current = ++sequence.current;
    last.current = { id, query: term };
    setSource(null); setError(""); setLoading(true); setQuery(term); setOpened(true);
    try { const value = await json<Source>(`${api}/source/${id}`); if (current === sequence.current) setSource(value); }
    catch (e) { if (current === sequence.current) setError(String((e as Error).message)); }
    finally { if (current === sequence.current) setLoading(false); }
  };
  useEffect(() => {
    const open = (event: Event) => {
      event.preventDefault();
      const detail = (event as CustomEvent).detail || {};
      opener.current = document.activeElement as HTMLElement;
      if (typeof detail.id === "string" && /^[a-f0-9]{32}$/.test(detail.id)) void load(detail.id, typeof detail.query === "string" ? detail.query.slice(0, 300) : "");
      else if (!detail.id) { sequence.current++; setOpened(true); setSource(null); setLoading(false); setError(""); }
    };
    const failed = (event: Event) => setError(String((event as CustomEvent).detail));
    window.addEventListener(eventName, open); window.addEventListener("local-ai:source-error", failed);
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === `${base}/project-history` && params.get("source")) void load(params.get("source")!, params.get("q") || "");
    return () => { sequence.current++; window.removeEventListener(eventName, open); window.removeEventListener("local-ai:source-error", failed); };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("ph-preview-open", opened);
    if (!opened) return;
    closeButton.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    window.addEventListener("keydown", key);
    return () => { document.body.classList.remove("ph-preview-open"); window.removeEventListener("keydown", key); };
  }, [opened]);
  useEffect(() => {
    if (!source || !article.current) return;
    const match = source.format === "conversation" ? article.current.querySelector(".ph-selected-message") : article.current.querySelector(`[data-line="${source.line}"]`);
    const highlightedMatch = match?.querySelector("mark") || (!match ? article.current.querySelector("mark") : null);
    (highlightedMatch || match)?.scrollIntoView?.({ block: "center" });
  }, [source]);
  if (!opened) return null;
  return <aside className="ph-preview" aria-label="Source preview">
    <header className="ph-preview-toolbar"><span>Source preview</span><button ref={closeButton} type="button" onClick={close} aria-label="Close source preview">Close ×</button></header>
    <div ref={article} className="ph-preview-scroll" tabIndex={0}>
      {loading && <p role="status">Opening source…</p>}
      {error && <p className="ph-error" role="alert">{error} {last.current.id && <button type="button" onClick={() => void load(last.current.id, last.current.query)}>Retry</button>}</p>}
      {source && <>
        <div className="ph-source-heading"><span className="ph-badge">{source.kind === "chat" ? "Past chat" : source.kind === "notebook" ? "Notebook" : "Report"}</span><h1>{source.title}</h1><p>{date(source.current_date || source.date)}</p><p className="ph-location">{source.location}</p><p className="ph-section">{source.section}{source.line ? ` · line ${source.line}` : ""}</p>
          <button type="button" onClick={() => {
            const url = `${window.location.origin}${base}/project-history?source=${source.id}&q=${encodeURIComponent(query)}`;
            navigator.clipboard.writeText(url).catch(() => setError("Could not copy the link. Use the source link from the search results."));
          }}>Copy source link</button>
        </div>
        {source.format === "conversation" ? <div className="ph-conversation"><p className="ph-muted">{source.context_note}</p>{source.messages?.map(message => <article className={`ph-message ${message.id === source.selected_message ? "ph-selected-message" : ""}`} key={message.id}>
          <header><strong>{message.role === "user" ? "You" : "Hermes"}</strong><time>{date(message.timestamp)}</time>{message.id === source.selected_message && <span>Matching message</span>}</header>
          <Markdown content={message.content || ""} source={source.id} query={query} />
        </article>)}</div> : <Markdown content={source.content || ""} source={source.id} query={query} />}
      </>}
      {!source && !loading && !error && <Search compact />}
    </div>
  </aside>;
}

function HistoryButton() {
  return <button type="button" className="ph-open-button" onClick={() => window.dispatchEvent(new CustomEvent(eventName))}>Project history</button>;
}

interface GalleryItem { id: string; remote: boolean; source?: string; caption: string; source_url: string }
interface GalleryGroup { id: string; title: string; date: number; images: GalleryItem[] }
function RemoteImage({ image }: { image: GalleryItem }) {
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!zoom) return;
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); setZoom(false); opener.current?.focus(); }
      if (e.key === "Tab") { e.preventDefault(); close.current?.focus(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [zoom]);
  if (failed) return <p className="ph-image-error">Image could not load. The source may require sign-in or prevent embedding.</p>;
  return <>
    <button ref={opener} type="button" className="ph-image-button" onClick={() => setZoom(true)} aria-label={`Enlarge ${image.caption || "image"}`}><img src={image.source} alt={image.caption || "Image result"} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} /></button>
    {zoom && <div className="ph-image-zoom" role="dialog" aria-modal="true" aria-label={image.caption || "Image preview"}><button ref={close} type="button" onClick={() => { setZoom(false); opener.current?.focus(); }}>Close image</button><img src={image.source} alt={image.caption || "Image result"} referrerPolicy="no-referrer" /></div>}
  </>;
}
function InlineGallery({ channel, profile = "", isActive, resumeId }: { channel: string; profile?: string; isActive: boolean; resumeId?: string }) {
  const [groups, setGroups] = useState<GalleryGroup[]>([]);
  const [session, setSession] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout>;
    setGroups([]); setSession(""); setError("");
    if (!isActive) return;
    const poll = async () => {
      try {
        const identity = await json<{ session_id: string | null }>(`${base}/api/pty/session?channel=${encodeURIComponent(channel)}&profile=${encodeURIComponent(profile)}`);
        const sid = identity.session_id;
        if (sid) {
          const result = await json<{ groups: GalleryGroup[] }>(`${api}/gallery?session=${encodeURIComponent(sid)}&profile=${encodeURIComponent(profile)}`);
          if (live) { setGroups(result.groups); setSession(sid); setError(""); }
        } else if (live) { setGroups([]); setSession(""); }
      } catch (e) { if (live) setError(String((e as Error).message)); }
      finally { if (live) timer = setTimeout(poll, 2500); }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [channel, profile, isActive, resumeId]);
  if (!isActive || (!groups.length && !error)) return null;
  const shown = expanded ? groups : groups.slice(-1);
  return <section className="ph-inline-gallery" aria-label="Images in this conversation">
    <header><strong>Images in this conversation</strong>{groups.length > 1 && <button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Show latest" : `Show all ${groups.length} groups`}</button>}</header>
    {error && <p className="ph-image-error" role="status">Image display needs attention: {error}</p>}
    <div className="ph-gallery-groups">{shown.map(group => <div key={group.id}><p className="ph-gallery-title">{group.title}</p><div className="ph-image-cards">{group.images.map(image => <figure key={image.id}>
      {image.remote ? <RemoteImage image={image} /> : <LocalImage source={image.id} href="" alt={image.caption} endpoint={`${api}/gallery/image/${image.id}?session=${encodeURIComponent(session)}&profile=${encodeURIComponent(profile)}`} />}
      <figcaption>{image.caption}{image.source_url && <a href={image.source_url} target="_blank" rel="noopener noreferrer">Source ↗</a>}</figcaption>
    </figure>)}</div></div>)}</div>
  </section>;
}
window.__HERMES_PLUGINS__.register("project-history", Search);
window.__HERMES_PLUGINS__.registerSlot("project-history", "header-right", HistoryButton);
window.__HERMES_PLUGINS__.registerSlot("project-history", "overlay", Preview);
window.__HERMES_PLUGINS__.registerSlot("project-history", "chat:bottom", InlineGallery);
export {};
