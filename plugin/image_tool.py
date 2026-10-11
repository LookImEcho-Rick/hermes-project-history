"""Agent tools provided by this user-owned plugin."""
import json
import html
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from hermes_constants import get_hermes_home
from .dashboard.history import History, source_url

IMAGE_SCHEMA = {
    "name": "display_images",
    "description": "Display images directly in the current Hermes dashboard chat. Use after image/web searches or creating local images, so the user sees pictures without clicking links. Supply actual image URLs, not web page URLs; local PNG/JPEG/WebP/GIF files in the project/workspace are supported. Captions and source links preserve attribution. This displays images; it does not search, generate or analyze them. Remote images load only when the user opens that chat. Returns registered display metadata, not a claim that an external image loaded successfully.",
    "parameters": {"type": "object", "properties": {
        "images": {"type": "array", "minItems": 1, "maxItems": 12, "items": {"type": "object", "properties": {
            "source": {"type": "string", "description": "Actual public HTTP(S) image URL or absolute local PNG/JPEG/WebP/GIF path."},
            "caption": {"type": "string", "description": "Short descriptive caption."},
            "source_url": {"type": "string", "description": "Optional public source page URL for attribution."}
        }, "required": ["source"], "additionalProperties": False}},
        "title": {"type": "string", "description": "Short title for this group of images."}
    }, "required": ["images"], "additionalProperties": False}
}
SEARCH_SCHEMA = {
    "name": "project_history_search",
    "description": "Search local project notebooks, reports and past Hermes chats. Returns exact source excerpts and clickable evidence links that open in the dashboard preview. Use distinctive keywords, read the evidence, distinguish current decisions from historical reports, and cite the returned URLs. It never changes source files or conversations.",
    "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "kind": {"type": "string", "enum": ["all", "notebook", "report", "chat"]}, "refresh": {"type": "boolean", "description": "Refresh the index when sources have changed."}}, "required": ["query"], "additionalProperties": False}
}
IMAGE_SEARCH_SCHEMA = {
    "name": "search_images",
    "description": "Find public images on Wikimedia Commons and display them directly in the current Hermes chat. Use for requests such as 'show me a picture of a red panda'. Returns actual image URLs, captions and attribution. This searches existing images; it does not generate new artwork. For images from other web-search providers or local generated files, use display_images.",
    "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Subject to find."}, "count": {"type": "integer", "minimum": 1, "maximum": 6}}, "required": ["query"], "additionalProperties": False}
}


def display_images(args, session_id=None, **kwargs):
    try:
        result = History(get_hermes_home()).show_images(args, session_id)
        return json.dumps({"ok": True, "display_registered": True, **result}, ensure_ascii=False)
    except (ValueError, OSError, RuntimeError) as exc:
        return json.dumps({"ok": False, "error": str(exc)})


def project_history_search(args, dashboard_base="http://127.0.0.1:9119", **kwargs):
    try:
        store = History(get_hermes_home())
        if args.get("refresh"):
            store.refresh()
        result = store.search(args.get("query", ""), args.get("kind", "all"), 8)
        for item in result["results"]:
            item["url"] = source_url(item["id"], args.get("query", ""), dashboard_base)
        return json.dumps(result, ensure_ascii=False)
    except (ValueError, OSError, RuntimeError) as exc:
        return json.dumps({"ok": False, "error": str(exc)})


def search_images(args, session_id=None, **kwargs):
    try:
        query = args.get("query", "")
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200:
            raise ValueError("Supply a subject between 1 and 200 characters.")
        count = max(1, min(int(args.get("count", 3)), 6))
        parameters = {"action": "query", "format": "json", "generator": "search", "gsrsearch": query, "gsrnamespace": 6, "gsrlimit": count * 2, "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "iiurlwidth": 720}
        request = Request("https://commons.wikimedia.org/w/api.php?" + urlencode(parameters), headers={"User-Agent": "LocalAI-Hermes-ProjectHistory/1.0 (personal image search)", "Accept": "application/json"})
        with urlopen(request, timeout=20) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Image search response was too large.")
        data = json.loads(raw)
        images = []
        for page in sorted(data.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0)):
            info = (page.get("imageinfo") or [{}])[0]
            if info.get("mime") not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
                continue
            extra = info.get("extmetadata", {})
            artist = html.unescape(re.sub(r"<[^>]+>", "", extra.get("Artist", {}).get("value", "")))
            license_name = html.unescape(re.sub(r"<[^>]+>", "", extra.get("LicenseShortName", {}).get("value", "")))
            title = page.get("title", "Image").removeprefix("File:")
            caption = " · ".join(value for value in (title, artist[:120], license_name) if value)
            images.append({"source": info.get("thumburl") or info["url"], "caption": caption, "source_url": info.get("descriptionurl", "")})
            if len(images) == count:
                break
        if not images:
            return json.dumps({"ok": False, "error": "No supported Commons images found. Try another subject or use web_search and display_images with actual image URLs."})
        result = History(get_hermes_home()).show_images({"images": images, "title": query}, session_id)
        return json.dumps({"ok": True, "display_registered": True, "provider": "Wikimedia Commons", "images": images, **result}, ensure_ascii=False)
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        return json.dumps({"ok": False, "error": str(exc)})
