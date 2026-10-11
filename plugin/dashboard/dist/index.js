"use strict";
(() => {
  // Hermes/plugins/project-history/dashboard/src/index.tsx
  var window = globalThis.window;
  var host = window.__HERMES_PLUGIN_SDK__;
  if (!host || !/^1\./.test(host.sdkVersion) || !host.fetchJSON || !host.authedFetch || !window.__HERMES_PLUGINS__) {
    throw new Error("Project history: dashboard plugin SDK is incompatible. Run the Local AI compatibility check.");
  }
  var React = host.React;
  var { useState, useEffect, useRef } = React;
  var base = window.__HERMES_BASE_PATH__ || "";
  var api = `${base}/api/plugins/project-history`;
  var eventName = "local-ai:open-source";
  var json = host.fetchJSON;
  function date(value) {
    return value ? new Date(value * 1e3).toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable";
  }
  function openSource(id, query = "") {
    window.dispatchEvent(new CustomEvent(eventName, { detail: { id, query } }));
  }
  function highlighted(text, query) {
    const terms = (query.match(/[\p{L}\p{N}_]+/gu) || []).filter((t) => t.length > 1).slice(0, 12);
    if (!terms.length) return text;
    const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(pattern).map((part, i) => i % 2 ? /* @__PURE__ */ React.createElement("mark", { key: i }, part) : part);
  }
  function safeExternal(href) {
    try {
      return ["http:", "https:"].includes(new URL(href).protocol);
    } catch {
      return false;
    }
  }
  function LocalImage({ source, href, alt, endpoint }) {
    const [url, setUrl] = useState("");
    const [error, setError] = useState("");
    const [zoom, setZoom] = useState(false);
    const button = useRef(null);
    useEffect(() => {
      let live = true;
      let objectUrl = "";
      setUrl("");
      setError("");
      host.authedFetch(endpoint || `${api}/image/${source}?href=${encodeURIComponent(href)}`).then(async (response) => {
        if (!response.ok) throw new Error("Image is unavailable or outside the approved project folders.");
        const blob = await response.blob();
        if (live) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      }).catch((e) => {
        if (live) setError(String(e.message));
      });
      return () => {
        live = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [source, href, endpoint]);
    useEffect(() => {
      if (!zoom) return;
      const key = (event) => {
        if (event.key === "Escape") {
          event.stopImmediatePropagation();
          setZoom(false);
          button.current?.focus();
        }
        if (event.key === "Tab") {
          event.preventDefault();
          document.getElementById("ph-image-close")?.focus();
        }
      };
      window.addEventListener("keydown", key, true);
      document.getElementById("ph-image-close")?.focus();
      return () => window.removeEventListener("keydown", key, true);
    }, [zoom]);
    if (error) return /* @__PURE__ */ React.createElement("span", { className: "ph-notice" }, alt || "Image", ": ", error);
    if (!url) return /* @__PURE__ */ React.createElement("span", { className: "ph-muted" }, "Loading image\u2026");
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { ref: button, type: "button", className: "ph-image-button", onClick: () => setZoom(true), "aria-label": `Enlarge ${alt || "image"}` }, /* @__PURE__ */ React.createElement("img", { src: url, alt, loading: "lazy" })), zoom && /* @__PURE__ */ React.createElement("div", { className: "ph-image-zoom", role: "dialog", "aria-modal": "true", "aria-label": alt || "Image preview" }, /* @__PURE__ */ React.createElement("button", { type: "button", id: "ph-image-close", onClick: () => {
      setZoom(false);
      button.current?.focus();
    } }, "Close image"), /* @__PURE__ */ React.createElement("img", { src: url, alt })));
  }
  function inline(text, source, query) {
    const pattern = /(!?\[[^\]]*\]\([^\n]*?\)|`[^`]+`|\*\*[^*]+\*\*)/g;
    return text.split(pattern).filter(Boolean).map((part, index) => {
      if (part.startsWith("`")) return /* @__PURE__ */ React.createElement("code", { key: index }, part.slice(1, -1));
      if (part.startsWith("**")) return /* @__PURE__ */ React.createElement("strong", { key: index }, highlighted(part.slice(2, -2), query));
      const link = /^(!?)\[([^\]]*)\]\((.*?)\)$/.exec(part);
      if (!link) return /* @__PURE__ */ React.createElement(React.Fragment, { key: index }, highlighted(part, query));
      const [, image, label, target] = link;
      const href = target.trim().replace(/^<|>$/g, "");
      if (image) return /* @__PURE__ */ React.createElement(LocalImage, { key: index, source, href, alt: label });
      if (safeExternal(href)) {
        const url = new URL(href);
        if (url.origin === window.location.origin && url.pathname === `${base}/project-history` && /^[a-f0-9]{32}$/.test(url.searchParams.get("source") || "")) {
          return /* @__PURE__ */ React.createElement("a", { key: index, href, onClick: (e) => {
            e.preventDefault();
            openSource(url.searchParams.get("source"), query);
          } }, label);
        }
        return /* @__PURE__ */ React.createElement("a", { key: index, href, target: "_blank", rel: "noopener noreferrer" }, highlighted(label, query));
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return /* @__PURE__ */ React.createElement("span", { key: index }, label, " (unsupported link)");
      return /* @__PURE__ */ React.createElement("button", { key: index, type: "button", className: "ph-inline-link", onClick: () => {
        json(`${api}/link/${source}?href=${encodeURIComponent(href)}`).then((result) => openSource(result.id, query)).catch((e) => window.dispatchEvent(new CustomEvent("local-ai:source-error", { detail: String(e.message) })));
      } }, highlighted(label, query));
    });
  }
  function Markdown({ content, source, query }) {
    const lines = content.split("\n");
    const nodes = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const number = i + 1;
      if (/^(```|~~~)/.test(line)) {
        const delimiter = line.slice(0, 3);
        const code = [];
        while (++i < lines.length && !lines[i].startsWith(delimiter)) code.push(lines[i]);
        nodes.push(/* @__PURE__ */ React.createElement("pre", { key: number, "data-line": number }, /* @__PURE__ */ React.createElement("code", null, highlighted(code.join("\n"), query))));
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        nodes.push(React.createElement(`h${heading[1].length}`, { key: number, "data-line": number }, inline(heading[2], source, query)));
        continue;
      }
      if (i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]) && line.includes("|")) {
        const cells = (row) => row.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
        const headers = cells(line);
        const rows = [];
        i++;
        while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) rows.push(cells(lines[++i]));
        nodes.push(/* @__PURE__ */ React.createElement("div", { className: "ph-table", key: number, "data-line": number }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, headers.map((cell, n) => /* @__PURE__ */ React.createElement("th", { key: n }, inline(cell, source, query))))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((row, n) => /* @__PURE__ */ React.createElement("tr", { key: n }, row.map((cell, j) => /* @__PURE__ */ React.createElement("td", { key: j }, inline(cell, source, query)))))))));
        continue;
      }
      const startsBlock = (value) => /^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>|```|~~~|\|)/.test(value) || /^\s*([-*_])\1\1+\s*$/.test(value);
      if (line.trim() && !/^>/.test(line) && !/^\s*([-*_])\1\1+\s*$/.test(line)) {
        const list = /^\s*(?:[-*+]\s|\d+\.\s)/.test(line);
        while (i + 1 < lines.length && lines[i + 1].trim() && !startsBlock(lines[i + 1]) && (!list || /^\s{2,}\S/.test(lines[i + 1]))) line += " " + lines[++i].trim();
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        nodes.push(/* @__PURE__ */ React.createElement("div", { className: "ph-list-item", key: number, "data-line": number }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\u2022"), /* @__PURE__ */ React.createElement("div", null, inline(line.replace(/^\s*[-*+]\s+/, ""), source, query))));
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        nodes.push(/* @__PURE__ */ React.createElement("div", { className: "ph-list-item", key: number, "data-line": number }, /* @__PURE__ */ React.createElement("span", null, line.match(/^\s*(\d+\.)/)[1]), /* @__PURE__ */ React.createElement("div", null, inline(line.replace(/^\s*\d+\.\s+/, ""), source, query))));
        continue;
      }
      if (/^>/.test(line)) {
        nodes.push(/* @__PURE__ */ React.createElement("blockquote", { key: number, "data-line": number }, inline(line.replace(/^>\s?/, ""), source, query)));
        continue;
      }
      if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
        nodes.push(/* @__PURE__ */ React.createElement("hr", { key: number }));
        continue;
      }
      nodes.push(line.trim() ? line.includes("![") ? /* @__PURE__ */ React.createElement("div", { key: number, "data-line": number }, inline(line, source, query)) : /* @__PURE__ */ React.createElement("p", { key: number, "data-line": number }, inline(line, source, query)) : /* @__PURE__ */ React.createElement("div", { key: number, className: "ph-paragraph-space" }));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "ph-document" }, nodes);
  }
  function Search({ compact = false }) {
    const [query, setQuery] = useState("");
    const [kind, setKind] = useState("all");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const sequence = useRef(0);
    const run = async (refresh = false) => {
      const current = ++sequence.current;
      setLoading(true);
      setError("");
      try {
        if (refresh) await json(`${api}/refresh`, { method: "POST" });
        const response = await json(`${api}/search?q=${encodeURIComponent(query)}&kind=${kind}`);
        if (current === sequence.current) setResult(response);
      } catch (e) {
        if (current === sequence.current) setError(String(e.message));
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    };
    useEffect(() => {
      void run();
      return () => {
        sequence.current++;
      };
    }, []);
    return /* @__PURE__ */ React.createElement("section", { className: `ph-search ${compact ? "ph-compact" : ""}`, "aria-label": "Project history search" }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("h1", null, compact ? "Find a source" : "Project history"), /* @__PURE__ */ React.createElement("p", null, "Find the decisions, reports and conversations behind your work.")), /* @__PURE__ */ React.createElement("form", { onSubmit: (e) => {
      e.preventDefault();
      void run();
    } }, /* @__PURE__ */ React.createElement("label", { htmlFor: compact ? "ph-query-compact" : "ph-query" }, "Search your history"), /* @__PURE__ */ React.createElement("div", { className: "ph-search-row" }, /* @__PURE__ */ React.createElement("input", { id: compact ? "ph-query-compact" : "ph-query", value: query, onChange: (e) => setQuery(e.target.value), maxLength: 300, placeholder: "Try MTP, compression, or backup" }), /* @__PURE__ */ React.createElement("button", { type: "submit", disabled: loading }, "Search")), /* @__PURE__ */ React.createElement("div", { className: "ph-search-row" }, /* @__PURE__ */ React.createElement("label", null, "Sources ", /* @__PURE__ */ React.createElement("select", { value: kind, onChange: (e) => setKind(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "All sources"), /* @__PURE__ */ React.createElement("option", { value: "notebook" }, "Notebooks"), /* @__PURE__ */ React.createElement("option", { value: "report" }, "Reports"), /* @__PURE__ */ React.createElement("option", { value: "chat" }, "Past chats"))), /* @__PURE__ */ React.createElement("button", { type: "button", disabled: loading, onClick: () => void run(true) }, "Refresh history"))), loading && /* @__PURE__ */ React.createElement("p", { role: "status" }, result ? "Searching\u2026" : "Preparing your local history\u2026"), error && /* @__PURE__ */ React.createElement("p", { className: "ph-error", role: "alert" }, error, " ", /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => void run() }, "Retry")), result && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "ph-muted" }, result.results.length, " shown \xB7 ", result.status.sources.toLocaleString(), " indexed sections and messages \xB7 ", query ? "Search matches" : "Latest source activity"), /* @__PURE__ */ React.createElement("p", { className: "ph-muted" }, "Updated ", result.status.updated ? new Date(result.status.updated).toLocaleString() : "not yet", ". Report dates reflect file updates; chat dates reflect message times."), !!result.status.warnings.length && /* @__PURE__ */ React.createElement("details", { className: "ph-notice" }, /* @__PURE__ */ React.createElement("summary", null, result.status.warnings.length, " indexing notices"), result.status.warnings.map((warning, n) => /* @__PURE__ */ React.createElement("p", { key: n }, warning))), !result.results.length && /* @__PURE__ */ React.createElement("p", null, "No matches. Try a shorter phrase or a distinctive name, then refresh if the source is new."), /* @__PURE__ */ React.createElement("div", { className: "ph-results" }, result.results.map((item) => /* @__PURE__ */ React.createElement("a", { className: "ph-result", key: item.id, href: `${base}/project-history?source=${item.id}&q=${encodeURIComponent(query)}`, onClick: (e) => {
      e.preventDefault();
      openSource(item.id, query);
    } }, /* @__PURE__ */ React.createElement("div", { className: "ph-result-meta" }, /* @__PURE__ */ React.createElement("span", null, item.kind === "chat" ? "Past chat" : item.kind === "notebook" ? "Notebook" : "Report"), /* @__PURE__ */ React.createElement("time", null, date(item.date))), /* @__PURE__ */ React.createElement("h2", null, highlighted(item.title, query)), /* @__PURE__ */ React.createElement("p", { className: "ph-section" }, item.section), /* @__PURE__ */ React.createElement("p", null, highlighted(item.excerpt, query)), /* @__PURE__ */ React.createElement("span", { className: "ph-location" }, item.location, item.line ? ` \xB7 line ${item.line}` : ""))))));
  }
  function Preview() {
    const [opened, setOpened] = useState(false);
    const [source, setSource] = useState(null);
    const [query, setQuery] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const sequence = useRef(0);
    const article = useRef(null);
    const opener = useRef(null);
    const closeButton = useRef(null);
    const last = useRef({ id: "", query: "" });
    const close = () => {
      sequence.current++;
      setOpened(false);
      opener.current?.focus();
    };
    const load = async (id, term) => {
      const current = ++sequence.current;
      last.current = { id, query: term };
      setSource(null);
      setError("");
      setLoading(true);
      setQuery(term);
      setOpened(true);
      try {
        const value = await json(`${api}/source/${id}`);
        if (current === sequence.current) setSource(value);
      } catch (e) {
        if (current === sequence.current) setError(String(e.message));
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    };
    useEffect(() => {
      const open = (event) => {
        event.preventDefault();
        const detail = event.detail || {};
        opener.current = document.activeElement;
        if (typeof detail.id === "string" && /^[a-f0-9]{32}$/.test(detail.id)) void load(detail.id, typeof detail.query === "string" ? detail.query.slice(0, 300) : "");
        else if (!detail.id) {
          sequence.current++;
          setOpened(true);
          setSource(null);
          setLoading(false);
          setError("");
        }
      };
      const failed = (event) => setError(String(event.detail));
      window.addEventListener(eventName, open);
      window.addEventListener("local-ai:source-error", failed);
      const params = new URLSearchParams(window.location.search);
      if (window.location.pathname === `${base}/project-history` && params.get("source")) void load(params.get("source"), params.get("q") || "");
      return () => {
        sequence.current++;
        window.removeEventListener(eventName, open);
        window.removeEventListener("local-ai:source-error", failed);
      };
    }, []);
    useEffect(() => {
      document.body.classList.toggle("ph-preview-open", opened);
      if (!opened) return;
      closeButton.current?.focus();
      const key = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      };
      window.addEventListener("keydown", key);
      return () => {
        document.body.classList.remove("ph-preview-open");
        window.removeEventListener("keydown", key);
      };
    }, [opened]);
    useEffect(() => {
      if (!source || !article.current) return;
      const match = source.format === "conversation" ? article.current.querySelector(".ph-selected-message") : article.current.querySelector(`[data-line="${source.line}"]`);
      const highlightedMatch = match?.querySelector("mark") || (!match ? article.current.querySelector("mark") : null);
      (highlightedMatch || match)?.scrollIntoView?.({ block: "center" });
    }, [source]);
    if (!opened) return null;
    return /* @__PURE__ */ React.createElement("aside", { className: "ph-preview", "aria-label": "Source preview" }, /* @__PURE__ */ React.createElement("header", { className: "ph-preview-toolbar" }, /* @__PURE__ */ React.createElement("span", null, "Source preview"), /* @__PURE__ */ React.createElement("button", { ref: closeButton, type: "button", onClick: close, "aria-label": "Close source preview" }, "Close \xD7")), /* @__PURE__ */ React.createElement("div", { ref: article, className: "ph-preview-scroll", tabIndex: 0 }, loading && /* @__PURE__ */ React.createElement("p", { role: "status" }, "Opening source\u2026"), error && /* @__PURE__ */ React.createElement("p", { className: "ph-error", role: "alert" }, error, " ", last.current.id && /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => void load(last.current.id, last.current.query) }, "Retry")), source && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "ph-source-heading" }, /* @__PURE__ */ React.createElement("span", { className: "ph-badge" }, source.kind === "chat" ? "Past chat" : source.kind === "notebook" ? "Notebook" : "Report"), /* @__PURE__ */ React.createElement("h1", null, source.title), /* @__PURE__ */ React.createElement("p", null, date(source.current_date || source.date)), /* @__PURE__ */ React.createElement("p", { className: "ph-location" }, source.location), /* @__PURE__ */ React.createElement("p", { className: "ph-section" }, source.section, source.line ? ` \xB7 line ${source.line}` : ""), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => {
      const url = `${window.location.origin}${base}/project-history?source=${source.id}&q=${encodeURIComponent(query)}`;
      navigator.clipboard.writeText(url).catch(() => setError("Could not copy the link. Use the source link from the search results."));
    } }, "Copy source link")), source.format === "conversation" ? /* @__PURE__ */ React.createElement("div", { className: "ph-conversation" }, /* @__PURE__ */ React.createElement("p", { className: "ph-muted" }, source.context_note), source.messages?.map((message) => /* @__PURE__ */ React.createElement("article", { className: `ph-message ${message.id === source.selected_message ? "ph-selected-message" : ""}`, key: message.id }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("strong", null, message.role === "user" ? "You" : "Hermes"), /* @__PURE__ */ React.createElement("time", null, date(message.timestamp)), message.id === source.selected_message && /* @__PURE__ */ React.createElement("span", null, "Matching message")), /* @__PURE__ */ React.createElement(Markdown, { content: message.content || "", source: source.id, query })))) : /* @__PURE__ */ React.createElement(Markdown, { content: source.content || "", source: source.id, query })), !source && !loading && !error && /* @__PURE__ */ React.createElement(Search, { compact: true })));
  }
  function HistoryButton() {
    return /* @__PURE__ */ React.createElement("button", { type: "button", className: "ph-open-button", onClick: () => window.dispatchEvent(new CustomEvent(eventName)) }, "Project history");
  }
  function RemoteImage({ image }) {
    const [failed, setFailed] = useState(false);
    const [zoom, setZoom] = useState(false);
    const close = useRef(null);
    const opener = useRef(null);
    useEffect(() => {
      if (!zoom) return;
      close.current?.focus();
      const key = (e) => {
        if (e.key === "Escape") {
          e.stopImmediatePropagation();
          setZoom(false);
          opener.current?.focus();
        }
        if (e.key === "Tab") {
          e.preventDefault();
          close.current?.focus();
        }
      };
      window.addEventListener("keydown", key, true);
      return () => window.removeEventListener("keydown", key, true);
    }, [zoom]);
    if (failed) return /* @__PURE__ */ React.createElement("p", { className: "ph-image-error" }, "Image could not load. The source may require sign-in or prevent embedding.");
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { ref: opener, type: "button", className: "ph-image-button", onClick: () => setZoom(true), "aria-label": `Enlarge ${image.caption || "image"}` }, /* @__PURE__ */ React.createElement("img", { src: image.source, alt: image.caption || "Image result", referrerPolicy: "no-referrer", loading: "lazy", onError: () => setFailed(true) })), zoom && /* @__PURE__ */ React.createElement("div", { className: "ph-image-zoom", role: "dialog", "aria-modal": "true", "aria-label": image.caption || "Image preview" }, /* @__PURE__ */ React.createElement("button", { ref: close, type: "button", onClick: () => {
      setZoom(false);
      opener.current?.focus();
    } }, "Close image"), /* @__PURE__ */ React.createElement("img", { src: image.source, alt: image.caption || "Image result", referrerPolicy: "no-referrer" })));
  }
  function InlineGallery({ channel, profile = "", isActive, resumeId }) {
    const [groups, setGroups] = useState([]);
    const [session, setSession] = useState("");
    const [error, setError] = useState("");
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
      let live = true;
      let timer;
      setGroups([]);
      setSession("");
      setError("");
      if (!isActive) return;
      const poll = async () => {
        try {
          const identity = await json(`${base}/api/pty/session?channel=${encodeURIComponent(channel)}&profile=${encodeURIComponent(profile)}`);
          const sid = identity.session_id;
          if (sid) {
            const result = await json(`${api}/gallery?session=${encodeURIComponent(sid)}&profile=${encodeURIComponent(profile)}`);
            if (live) {
              setGroups(result.groups);
              setSession(sid);
              setError("");
            }
          } else if (live) {
            setGroups([]);
            setSession("");
          }
        } catch (e) {
          if (live) setError(String(e.message));
        } finally {
          if (live) timer = setTimeout(poll, 2500);
        }
      };
      void poll();
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }, [channel, profile, isActive, resumeId]);
    if (!isActive || !groups.length && !error) return null;
    const shown = expanded ? groups : groups.slice(-1);
    return /* @__PURE__ */ React.createElement("section", { className: "ph-inline-gallery", "aria-label": "Images in this conversation" }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("strong", null, "Images in this conversation"), groups.length > 1 && /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setExpanded(!expanded) }, expanded ? "Show latest" : `Show all ${groups.length} groups`)), error && /* @__PURE__ */ React.createElement("p", { className: "ph-image-error", role: "status" }, "Image display needs attention: ", error), /* @__PURE__ */ React.createElement("div", { className: "ph-gallery-groups" }, shown.map((group) => /* @__PURE__ */ React.createElement("div", { key: group.id }, /* @__PURE__ */ React.createElement("p", { className: "ph-gallery-title" }, group.title), /* @__PURE__ */ React.createElement("div", { className: "ph-image-cards" }, group.images.map((image) => /* @__PURE__ */ React.createElement("figure", { key: image.id }, image.remote ? /* @__PURE__ */ React.createElement(RemoteImage, { image }) : /* @__PURE__ */ React.createElement(LocalImage, { source: image.id, href: "", alt: image.caption, endpoint: `${api}/gallery/image/${image.id}?session=${encodeURIComponent(session)}&profile=${encodeURIComponent(profile)}` }), /* @__PURE__ */ React.createElement("figcaption", null, image.caption, image.source_url && /* @__PURE__ */ React.createElement("a", { href: image.source_url, target: "_blank", rel: "noopener noreferrer" }, "Source \u2197")))))))));
  }
  window.__HERMES_PLUGINS__.register("project-history", Search);
  window.__HERMES_PLUGINS__.registerSlot("project-history", "header-right", HistoryButton);
  window.__HERMES_PLUGINS__.registerSlot("project-history", "overlay", Preview);
  window.__HERMES_PLUGINS__.registerSlot("project-history", "chat:bottom", InlineGallery);
})();
