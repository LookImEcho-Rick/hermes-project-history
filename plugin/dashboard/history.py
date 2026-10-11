"""Local evidence index. Original documents and state.db are always read-only."""
from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import socket
import threading
import time
from urllib.parse import quote, unquote, urlsplit

_LOCK = threading.RLock()
MAX_FILE = 2_000_000
MAX_MESSAGES = 30_000
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
SKIP_DIRS = {"archives", "node_modules", ".git", "home", "workspace", "fixtures", "profiles", "__pycache__", ".venv", "tools", "recovery", "setuprecovery", "portable-plugin", "hermes-source-restore-checks", "hermes-restore-checks", "hermes-restore-recovery"}


def identifier(key):
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def readonly(path):
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=3)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def sections(text):
    """Stable section anchors include duplicate heading occurrence, never text content."""
    lines = text.splitlines()
    starts, fenced = [(0, "Document")], False
    for i, line in enumerate(lines):
        if line.startswith("```") or line.startswith("~~~"):
            fenced = not fenced
        if not fenced and re.match(r"^#{1,6}\s+", line):
            title = re.sub(r"^#{1,6}\s+", "", line).strip()
            if i == 0:
                starts[0] = (0, title)
            else:
                starts.append((i, title))
    occurrences = {}
    for n, (start, heading) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        count = occurrences.get(heading, 0)
        occurrences[heading] = count + 1
        content = "\n".join(lines[start:end])
        if content.strip():
            yield f"{heading}:{count}", heading, start + 1, content


def query_terms(query):
    stop = {"a", "an", "the", "why", "did", "we", "what", "is", "was", "were", "do", "does", "how", "where", "when", "it", "to", "of", "on", "for", "and", "in", "my", "our", "with", "since"}
    return [word for word in re.findall(r"\w+", query.lower())[:24] if word not in stop][:12]


class History:
    def __init__(self, home):
        self.home = Path(home).resolve()
        # Extra reports belong only to the shared Local AI home, never another profile.
        parent = self.home.parent
        self.setup = parent if self.home.name == "Hermes" and (parent / "Launcher").is_dir() and (parent / "README.md").is_file() else None
        self.data = self.home / "plugin-data/project-history"

    def document_roots(self):
        roots = [(self.home / "workspace/project-notebooks", "notebook")]
        if self.setup:
            roots += [(self.setup / "Documents", "report"), (self.setup / "Inference/benchmarks", "report"), (self.setup / "ToolSuite/Results", "report")]
        return roots

    def approved_path(self, raw, *, image=False):
        path = Path(raw).resolve(strict=True)
        roots = [p.resolve() for p, _ in self.document_roots()]
        if image:
            roots += [self.home / "cache/images", self.home / "cache/screenshots", self.home / "cache/generated", self.home / "image_cache", self.home / "images"]
        if not any(path.is_relative_to(root) for root in roots):
            raise ValueError("Source is outside the approved project folders.")
        if path.suffix.lower() not in (IMAGE_TYPES if image else {".md"}):
            raise ValueError("Unsupported source type.")
        if not path.is_file() or path.stat().st_size > (20_000_000 if image else MAX_FILE):
            raise ValueError("Source is unavailable or too large to preview.")
        return path

    def files(self):
        for root, kind in self.document_roots():
            if not root.exists():
                continue
            for folder, dirs, names in os.walk(root, followlinks=False):
                def included(name):
                    child = Path(folder) / name
                    # Reports can contain complete source checkouts and isolated test homes.
                    return (name.lower() not in SKIP_DIRS and not child.is_symlink()
                            and not (hasattr(Path, "is_junction") and child.is_junction())
                            and not (child / "hermes_cli").is_dir()
                            and not ((child / "config.yaml").is_file()
                                     and ((child / "state.db").exists() or (child / ".env").exists()))
                            and not ((child / "skills").is_dir() and (child / "SOUL.md").is_file()))
                dirs[:] = sorted(d for d in dirs if included(d))
                for name in sorted(names):
                    if name.lower().endswith(".md"):
                        yield Path(folder) / name, kind

    def connection(self):
        self.data.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.data / "index.sqlite", timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, kind TEXT, title TEXT, location TEXT, section TEXT, line INTEGER, date REAL, content TEXT, ref TEXT)")
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS evidence USING fts5(id UNINDEXED, title, content, tokenize='porter unicode61')")
        conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
        return conn

    def document_rows(self, warnings):
        for raw, kind in self.files():
            try:
                path = self.approved_path(raw)
                text = path.read_text(encoding="utf-8-sig")
                location = str(path.relative_to(self.setup or self.home)).replace("\\", "/")
                title = next((line.lstrip("# ") for line in text.splitlines() if line.startswith("# ")), path.stem)
                stamp = path.stat().st_mtime
                for anchor, heading, line, content in sections(text):
                    key = identifier(f"file:{path}:{anchor}")
                    ref = json.dumps({"path": str(path), "anchor": anchor})
                    yield (key, kind, title, location, heading, line, stamp, content, ref)
            except (OSError, UnicodeError, ValueError) as exc:
                warnings.append(f"Skipped {raw.name}: {exc}")

    def chat_rows(self, warnings):
        db = self.home / "state.db"
        if not db.exists():
            return
        with closing(readonly(db)) as conn:
            self.check_chat_schema(conn)
            rows = conn.execute("SELECT m.id, m.session_id, m.role, m.content, m.timestamp, s.title, s.started_at FROM messages m JOIN sessions s ON s.id=m.session_id WHERE m.role IN ('user','assistant') AND m.content IS NOT NULL ORDER BY m.id DESC LIMIT ?", (MAX_MESSAGES + 1,)).fetchall()
            if len(rows) > MAX_MESSAGES:
                warnings.append(f"Chat indexing limited to the latest {MAX_MESSAGES:,} messages.")
            for row in rows[:MAX_MESSAGES]:
                content = row["content"]
                if not isinstance(content, str) or not content.strip():
                    continue
                if len(content) > MAX_FILE:
                    warnings.append(f"Skipped oversized chat message {row['id']}.")
                    continue
                ref = json.dumps({"session": row["session_id"], "message": row["id"]})
                yield (identifier(f"chat:{row['session_id']}:{row['id']}"), "chat", row["title"] or "Untitled conversation", f"Conversation · {row['session_id']}", row["role"].capitalize(), 0, row["timestamp"] or row["started_at"] or 0, content, ref)

    @staticmethod
    def check_chat_schema(conn):
        for table, required in {"sessions": {"id", "title", "started_at"}, "messages": {"id", "session_id", "role", "content", "timestamp"}}.items():
            columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            if not required.issubset(columns):
                raise RuntimeError("Hermes conversation storage changed. Project history needs a compatibility review; no conversation was modified.")

    def refresh(self):
        warnings = []
        with _LOCK, closing(self.connection()) as conn, conn:
            # All-or-nothing replacement: failed reads retain the previous complete index.
            rows = list(self.document_rows(warnings)) + list(self.chat_rows(warnings))
            conn.execute("DELETE FROM sources")
            conn.execute("DELETE FROM evidence")
            conn.executemany("INSERT INTO sources VALUES (?,?,?,?,?,?,?,?,?)", rows)
            conn.executemany("INSERT INTO evidence (id,title,content) VALUES (?,?,?)", [(r[0], r[2] + " " + r[4], r[7]) for r in rows])
            stats = {"updated": datetime.now(timezone.utc).isoformat(), "sources": len(rows), "warnings": warnings, "counts": {kind: sum(r[1] == kind for r in rows) for kind in ("notebook", "report", "chat")}}
            conn.execute("INSERT OR REPLACE INTO metadata VALUES ('status',?)", (json.dumps(stats),))
        return stats

    def status(self):
        with _LOCK, closing(self.connection()) as conn:
            row = conn.execute("SELECT value FROM metadata WHERE key='status'").fetchone()
            return json.loads(row[0]) if row else {"updated": None, "sources": 0, "counts": {}, "warnings": []}

    def search(self, query="", kind="all", limit=40):
        if len(query) > 300 or kind not in {"all", "notebook", "report", "chat"}:
            raise ValueError("Invalid search request.")
        if not self.status()["updated"]:
            self.refresh()
        terms = query_terms(query)
        limit = max(1, min(int(limit), 100))
        with _LOCK, closing(self.connection()) as conn:
            filter_sql = "" if kind == "all" else " AND s.kind=?"
            extra = [] if kind == "all" else [kind]
            if terms:
                match = " AND ".join('"' + word + '"' for word in terms)
                rows = conn.execute("SELECT s.*, snippet(evidence,2,'','', ' … ',48) AS excerpt FROM evidence JOIN sources s ON s.id=evidence.id WHERE evidence MATCH ?" + filter_sql + " ORDER BY bm25(evidence,0,3,1),s.date DESC LIMIT ?", [match, *extra, limit]).fetchall()
            else:
                rows = conn.execute("SELECT s.*, substr(s.content,1,350) AS excerpt FROM sources s WHERE 1=1" + filter_sql + " ORDER BY s.date DESC,s.id LIMIT ?", [*extra, limit]).fetchall()
            results = [self.summary(row) for row in rows]
        return {"results": results, "status": self.status(), "terms": terms}

    @staticmethod
    def summary(row):
        return {key: row[key] for key in ("id", "kind", "title", "location", "section", "line", "date", "excerpt")}

    def source(self, source_id):
        if not re.fullmatch(r"[a-f0-9]{32}", source_id):
            raise ValueError("Invalid source link.")
        with _LOCK, closing(self.connection()) as conn:
            row = conn.execute("SELECT *, '' AS excerpt FROM sources WHERE id=?", (source_id,)).fetchone()
        if row is None:
            raise FileNotFoundError("Source was removed or is not indexed. Refresh project history and search again.")
        result = self.summary(row)
        ref = json.loads(row["ref"])
        if row["kind"] == "chat":
            result.update(self.conversation(ref))
        else:
            path = self.approved_path(ref["path"])
            text = path.read_text(encoding="utf-8-sig")
            current = next((s for s in sections(text) if s[0] == ref["anchor"]), None)
            if current is None:
                raise FileNotFoundError("This section changed. Refresh project history to find the current source.")
            result.update(content=text, line=current[2], current_date=path.stat().st_mtime, format="markdown")
        return result

    def conversation(self, ref):
        with closing(readonly(self.home / "state.db")) as conn:
            self.check_chat_schema(conn)
            target = conn.execute("SELECT id FROM messages WHERE id=? AND session_id=? AND role IN ('user','assistant')", (ref["message"], ref["session"])).fetchone()
            if not target:
                raise FileNotFoundError("Conversation message is no longer available.")
            before = conn.execute("SELECT id,role,content,timestamp FROM messages WHERE session_id=? AND id<=? AND role IN ('user','assistant') ORDER BY id DESC LIMIT 5", (ref["session"], ref["message"])).fetchall()
            after = conn.execute("SELECT id,role,content,timestamp FROM messages WHERE session_id=? AND id>? AND role IN ('user','assistant') ORDER BY id LIMIT 4", (ref["session"], ref["message"])).fetchall()
        messages = [dict(r) for r in reversed(before)] + [dict(r) for r in after]
        return {"format": "conversation", "messages": messages, "selected_message": ref["message"], "session_id": ref["session"], "context_note": "Matching message with up to four messages before and after."}

    def linked_file(self, source_id, href, *, image=False):
        if len(href) > 2048:
            raise ValueError("Link is too long.")
        parts = urlsplit(href)
        if parts.scheme or parts.netloc or parts.query:
            raise ValueError("Only local document links can be previewed.")
        with _LOCK, closing(self.connection()) as conn:
            row = conn.execute("SELECT ref,kind FROM sources WHERE id=?", (source_id,)).fetchone()
        if not row or row["kind"] == "chat":
            raise ValueError("This source has no local document base.")
        base = self.approved_path(json.loads(row["ref"])["path"])
        return self.approved_path(base.parent / unquote(parts.path), image=image)

    def resolve_link(self, source_id, href):
        path = self.linked_file(source_id, href)
        fragment = unquote(urlsplit(href).fragment)
        text = path.read_text(encoding="utf-8-sig")
        chunks = list(sections(text))
        def slug(value):
            return re.sub(r"[^\w\s-]", "", value.lower()).replace(" ", "-")
        anchor, heading, line, _ = next((s for s in chunks if slug(s[1]) == fragment), chunks[0])
        key = identifier(f"file:{path}:{anchor}")
        with _LOCK, closing(self.connection()) as conn:
            present = conn.execute("SELECT 1 FROM sources WHERE id=?", (key,)).fetchone()
        if not present:
            self.refresh()
        with _LOCK, closing(self.connection()) as conn:
            if not conn.execute("SELECT 1 FROM sources WHERE id=?", (key,)).fetchone():
                raise FileNotFoundError("Linked document is outside the indexed collection.")
        return {"id": key, "section": heading, "line": line}

    @staticmethod
    def public_image_url(value):
        if not isinstance(value, str) or len(value) > 4096:
            raise ValueError("Image URL is invalid or too long.")
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
            raise ValueError("Image URLs must be public HTTP(S) links without credentials.")
        if parts.port not in {None, 80, 443}:
            raise ValueError("Image URLs must use a standard web port.")
        addresses = socket.getaddrinfo(parts.hostname, parts.port or 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError("Private-network and loopback image links are not supported.")
        return value

    def local_image(self, raw):
        path = Path(raw).resolve(strict=True)
        roots = [self.home / "workspace", self.home / "cache", self.home / "images", self.home / "image_cache"]
        if self.setup:
            roots += [self.setup / "Documents", self.setup / "ToolSuite/Results", self.setup / "Inference/benchmarks"]
        if not any(path.is_relative_to(root.resolve()) for root in roots):
            raise ValueError("Local images must be in the Hermes workspace/media or Local AI report folders.")
        if path.suffix.lower() not in IMAGE_TYPES or path.stat().st_size > 20_000_000:
            raise ValueError("Use a PNG, JPEG, GIF or WebP image up to 20 MB.")
        data = path.read_bytes()
        valid = {".png": data.startswith(b"\x89PNG\r\n\x1a\n"), ".jpg": data.startswith(b"\xff\xd8\xff"), ".jpeg": data.startswith(b"\xff\xd8\xff"), ".gif": data.startswith((b"GIF87a", b"GIF89a")), ".webp": data[:4] == b"RIFF" and data[8:12] == b"WEBP"}
        if not valid[path.suffix.lower()]:
            raise ValueError("The file does not contain the expected image format.")
        target = self.home / "cache/images/project-history" / (hashlib.sha256(data).hexdigest() + path.suffix.lower())
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(data)
        return str(target)

    def show_images(self, args, session_id):
        if not isinstance(session_id, str) or not session_id or len(session_id) > 200:
            raise ValueError("No current Hermes conversation identity was supplied; no images were published.")
        with closing(readonly(self.home / "state.db")) as conn:
            if not conn.execute("SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone():
                raise ValueError("Current conversation was not found; no images were published.")
        images = args.get("images")
        if not isinstance(images, list) or not 1 <= len(images) <= 12:
            raise ValueError("Supply between 1 and 12 images.")
        prepared = []
        for item in images:
            if not isinstance(item, dict) or not isinstance(item.get("source"), str):
                raise ValueError("Each image needs an image URL or local path.")
            raw = item["source"]
            remote = urlsplit(raw).scheme in {"http", "https"}
            source = self.public_image_url(raw) if remote else self.local_image(raw)
            attribution = self.public_image_url(item["source_url"]) if item.get("source_url") else ""
            caption = str(item.get("caption", ""))[:500]
            prepared.append({"id": identifier(f"{session_id}:{source}"), "source": source, "remote": remote, "caption": caption, "source_url": attribution})
        title = str(args.get("title", "Images"))[:160]
        with _LOCK, closing(self.connection()) as conn, conn:
            conn.execute("CREATE TABLE IF NOT EXISTS gallery (id TEXT PRIMARY KEY, session TEXT, date REAL, title TEXT, images TEXT)")
            group_id = identifier(f"{session_id}:{time.time_ns()}")
            conn.execute("INSERT INTO gallery VALUES (?,?,?,?,?)", (group_id, session_id, time.time(), title, json.dumps(prepared)))
        return {"group_id": group_id, "session_id": session_id, "count": len(prepared), "note": "Images registered for this conversation. Remote image loading is confirmed by the dashboard, not by this tool."}

    def gallery(self, session_id):
        if not isinstance(session_id, str) or not session_id or len(session_id) > 200:
            raise ValueError("A conversation identity is required.")
        with _LOCK, closing(self.connection()) as conn:
            exists = conn.execute("SELECT 1 FROM sqlite_master WHERE name='gallery'").fetchone()
            rows = conn.execute("SELECT * FROM gallery WHERE session=? ORDER BY date DESC LIMIT 30", (session_id,)).fetchall() if exists else []
        results = []
        for row in reversed(rows):
            images = json.loads(row["images"])
            for image in images:
                image.pop("source", None) if not image["remote"] else None
            results.append({"id": row["id"], "title": row["title"], "date": row["date"], "images": images})
        return {"groups": results}

    def gallery_image(self, session_id, image_id):
        with _LOCK, closing(self.connection()) as conn:
            rows = conn.execute("SELECT images FROM gallery WHERE session=?", (session_id,)).fetchall()
        for row in rows:
            for item in json.loads(row[0]):
                if item["id"] == image_id and not item["remote"]:
                    return self.approved_path(item["source"], image=True)
        raise FileNotFoundError("Image is not available in this conversation.")


def source_url(source_id, query="", base="http://127.0.0.1:9119"):
    return f"{base}/project-history?source={quote(source_id)}&q={quote(query)}"
