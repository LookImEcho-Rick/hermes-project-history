"""Isolated behaviour checks: never copy or mutate the shared profile."""
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("history_checks", ROOT / "plugin/dashboard/history.py")
history = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(history)


class HistoryChecks(unittest.TestCase):
    def test_recovery_checkouts_and_isolated_homes_are_not_report_sources(self):
        copied = self.root / "Documents/copied-source/hermes_cli"
        copied.mkdir(parents=True)
        (copied.parent / "PRIVATE.md").write_text("copied checkout fixture")
        fixture = self.root / "Documents/isolated-profile"
        fixture.mkdir()
        (fixture / "config.yaml").write_text("fixture")
        (fixture / ".env").write_text("")
        (fixture / "PRIVATE.md").write_text("isolated profile fixture")
        store = history.History(self.home)
        store.refresh()
        self.assertEqual(store.search("copied checkout")["results"], [])
        self.assertEqual(store.search("isolated profile")["results"], [])
        self.assertTrue(store.search("decoding")["results"])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "Hermes"
        self.notes = self.home / "workspace/project-notebooks/local-ai"
        self.notes.mkdir(parents=True)
        (self.root / "Launcher").mkdir()
        (self.root / "README.md").write_text("# Fixture")
        self.report = self.root / "Documents/check/REPORT.md"
        self.report.parent.mkdir(parents=True)
        self.report.write_text("# Speed report\n\n## MTP result\nDisabled MTP because measured decoding was slower.\n\n![Chart](chart.png)\n", encoding="utf-8")
        self.note = self.notes / "NOTEBOOK.md"
        self.note.write_text("# Local AI\n\n## Decisions\nUse Swift. MTP is disabled.\n\n[Report](../../../../Documents/check/REPORT.md#mtp-result)\n", encoding="utf-8")
        (self.report.parent / "chart.png").write_bytes(b"fixture image")
        (self.home / ".env").write_text("DO_NOT_INDEX=secret-fixture")
        self.db = self.home / "state.db"
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.executescript("CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,started_at REAL); CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT,role TEXT,content TEXT,timestamp REAL);")
            conn.execute("INSERT INTO sessions VALUES ('chat-1','Swift decision',100)")
            conn.executemany("INSERT INTO messages VALUES (?,?,?,?,?)", [(1,"chat-1","user","Should we use MTP?",101),(2,"chat-1","assistant","Disable MTP after the speed measurement.",102),(3,"chat-1","user","Keep the current cache settings.",103),(4,"chat-1","tool","tool-only-secret",104)])
        self.store = history.History(self.home)
        self.originals = {path: path.read_bytes() for path in (self.note,self.report,self.db,self.home / ".env")}

    def assert_originals(self):
        for path, value in self.originals.items():
            self.assertEqual(path.read_bytes(), value)

    def test_search_ranks_real_sources_and_returns_dates_locations(self):
        result = self.store.search("why did we disable MTP")
        self.assertTrue(result["results"])
        self.assertEqual({r["kind"] for r in self.store.search("MTP")["results"]}, {"notebook","report","chat"})
        self.assertTrue(all(r["date"] and r["location"] for r in result["results"]))
        self.assertEqual(self.store.search("MTP", "report")["results"][0]["section"], "MTP result")
        self.assert_originals()

    def test_preview_reads_current_document_and_resolves_relative_section_link(self):
        item = self.store.search("Swift", "notebook")["results"][0]
        link = self.store.resolve_link(item["id"], "../../../../Documents/check/REPORT.md#mtp-result")
        preview = self.store.source(link["id"])
        self.assertEqual(preview["section"], "MTP result")
        self.assertEqual(preview["line"], 3)
        self.assertEqual(preview["format"], "markdown")
        self.assertEqual(self.store.linked_file(link["id"], "chart.png", image=True), self.report.parent / "chart.png")
        self.assert_originals()

    def test_chat_preview_includes_surrounding_exchange_and_excludes_tools(self):
        item = self.store.search("measurement", "chat")["results"][0]
        source = self.store.source(item["id"])
        self.assertEqual(source["selected_message"], 2)
        self.assertEqual([m["id"] for m in source["messages"]], [1,2,3])
        self.assertFalse(self.store.search("tool-only-secret")["results"])
        self.assert_originals()

    def test_traversal_secrets_remote_links_and_non_images_are_refused(self):
        item = self.store.search("Swift", "notebook")["results"][0]
        for href in ("../../../../Hermes/.env", "https://evil.invalid/secret", "//evil.invalid/file", "file:///C:/secret", "%2e%2e/%2e%2e/%2e%2e/%2e%2e/Hermes/.env"):
            with self.subTest(href=href), self.assertRaises((ValueError, FileNotFoundError)):
                self.store.resolve_link(item["id"], href)
        with self.assertRaises(ValueError):
            self.store.linked_file(item["id"], "NOTEBOOK.md", image=True)
        self.assertFalse(self.store.search("DO_NOT_INDEX")["results"])
        self.assert_originals()

    def test_removed_source_and_refresh_do_not_return_stale_evidence(self):
        item = self.store.search("slower", "report")["results"][0]
        self.report.unlink()
        with self.assertRaises(FileNotFoundError): self.store.source(item["id"])
        self.store.refresh()
        self.assertFalse(self.store.search("slower", "report")["results"])
        with self.assertRaises(FileNotFoundError): self.store.source(item["id"])

    def test_schema_change_is_visible_and_retains_complete_previous_index(self):
        self.store.refresh()
        status = self.store.status()
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute("ALTER TABLE messages RENAME COLUMN timestamp TO changed_timestamp")
        with self.assertRaisesRegex(RuntimeError, "compatibility review"):
            self.store.refresh()
        self.assertEqual(self.store.status(), status)

    def test_query_operators_are_literal_and_invalid_parameters_are_rejected(self):
        self.assertEqual(self.store.search("\" ( ) * OR NOT ; DROP TABLE sources")["results"], [])
        with self.assertRaises(ValueError): self.store.search("x" * 301)
        with self.assertRaises(ValueError): self.store.search("MTP", "secret")
        with self.assertRaises(ValueError): self.store.source("../secret")
        self.assert_originals()

    def test_profile_home_cannot_reach_shared_home_reports_or_chats(self):
        profile = self.home / "profiles/isolated"
        (profile / "workspace/project-notebooks").mkdir(parents=True)
        (profile / "workspace/project-notebooks/NOTEBOOK.md").write_text("# Profile only\nPrivate penguin")
        isolated = history.History(profile)
        self.assertIsNone(isolated.setup)
        self.assertFalse(isolated.search("MTP")["results"])
        self.assertTrue(isolated.search("penguin")["results"])
        with self.assertRaises(ValueError): isolated.approved_path(self.report)

    def test_rebuild_preserves_links_when_section_content_changes(self):
        item = self.store.search("Swift", "notebook")["results"][0]
        self.note.write_text(self.note.read_text() + "\nUpdated evidence without renaming heading.\n")
        self.store.refresh()
        source = self.store.source(item["id"])
        self.assertIn("Updated evidence", source["content"])

    def test_file_preview_detects_deleted_section(self):
        item = self.store.search("Swift", "notebook")["results"][0]
        self.note.write_text("# Different section\n")
        with self.assertRaisesRegex(FileNotFoundError, "section changed"):
            self.store.source(item["id"])

    def test_local_images_are_visible_without_changing_sources_and_are_session_scoped(self):
        image = self.notes / "picture.png"
        image.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        result = self.store.show_images({"images": [{"source": str(image), "caption": "Chart"}], "title": "Test images"}, "chat-1")
        self.assertEqual(result["count"], 1)
        group = self.store.gallery("chat-1")["groups"][0]
        self.assertEqual(group["images"][0]["caption"], "Chart")
        self.assertNotIn("source", group["images"][0])
        saved = self.store.gallery_image("chat-1", group["images"][0]["id"])
        self.assertEqual(saved.read_bytes(), image.read_bytes())
        self.assertIn("cache/images/project-history", saved.as_posix())
        self.assertEqual(self.store.gallery("different-chat")["groups"], [])
        with self.assertRaises(FileNotFoundError): self.store.gallery_image("different-chat", group["images"][0]["id"])
        self.assert_originals()

    def test_image_tool_refuses_missing_session_invalid_files_and_private_urls(self):
        image = self.notes / "fake.png"
        image.write_text("not an image")
        with self.assertRaises(ValueError): self.store.show_images({"images": [{"source": str(image)}]}, None)
        with self.assertRaises(ValueError): self.store.show_images({"images": [{"source": str(image)}]}, "chat-1")
        with self.assertRaises(ValueError): self.store.show_images({"images": [{"source": str(self.home / ".env")}]}, "chat-1")
        for url in ("http://127.0.0.1/private.png", "http://[::1]/private.png", "https://user:password@example.org/a.png", "file:///secret", "https://example.org:9999/a.png"):
            with self.subTest(url=url), self.assertRaises(ValueError): self.store.public_image_url(url)
        self.assert_originals()

    def test_public_web_images_keep_captions_and_attribution_without_server_fetch(self):
        with patch.object(history.socket, "getaddrinfo", return_value=[(2,1,6,"",("93.184.216.34",443))]):
            self.store.show_images({"images": [{"source": "https://example.org/image.png", "caption": "Reference", "source_url": "https://example.org/source"}]}, "chat-1")
        item = self.store.gallery("chat-1")["groups"][0]["images"][0]
        self.assertTrue(item["remote"])
        self.assertEqual(item["source_url"], "https://example.org/source")
        self.assertFalse((self.home / "cache").exists())
        self.assert_originals()


if __name__ == "__main__":
    unittest.main(verbosity=2)
