"""Install the user-owned plugin and a narrowly scoped dashboard adapter."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

PACKAGE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")))
    parser.add_argument("--source", type=Path, required=True, help="Hermes source checkout")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--plugin-only", action="store_true", help="Search/tools only; no inline chat integration")
    args = parser.parse_args()
    home, source = args.home.resolve(), args.source.resolve()
    manifest = json.loads((PACKAGE / "release.json").read_text())
    for relative, expected in manifest["package_files"].items():
        if digest(PACKAGE / relative) != expected:
            raise SystemExit("Package checksum mismatch: " + relative)
    if not (source / "hermes_cli/plugins.py").is_file():
        raise SystemExit("Select an installed Hermes source checkout.")
    targets = [(PACKAGE / "plugin", home / "plugins/project-history"), (PACKAGE / "skill", home / "skills/note-taking/project-history")]
    for origin, target in targets:
        if target.exists():
            for file in origin.rglob("*"):
                if file.is_file() and not {"node_modules", "__pycache__", ".git"}.intersection(file.parts) and (not (target / file.relative_to(origin)).is_file() or digest(file) != digest(target / file.relative_to(origin))):
                    raise SystemExit("Existing installation differs; preserve/review it before upgrading: " + str(target))
    patch = PACKAGE / "adapter.patch"
    already = all((source / relative).is_file() and digest(source / relative) == expected for relative, expected in manifest["adapter_files"].items())
    if not args.plugin_only and not already:
        for relative in manifest["new_adapter_files"]:
            if (source / relative).exists():
                raise SystemExit("Adapter file already exists with different contents: " + relative)
        subprocess.run(["git", "-C", str(source), "apply", "--check", str(patch)], check=True)
    if args.check_only:
        print("PASS: package integrity and requested installation compatibility; nothing changed.")
        return
    if not args.plugin_only and not already:
        backup = home / "plugin-data/project-history/install-backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        for relative in manifest["adapter_files"]:
            file = source / relative
            if file.is_file():
                saved = backup / relative
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file, saved)
        subprocess.run(["git", "-C", str(source), "apply", str(patch)], check=True)
        for relative in manifest["new_adapter_files"]:
            file = source / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(PACKAGE / "adapter-files" / relative, file)
    for origin, target in targets:
        shutil.copytree(origin, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "__pycache__", ".git"))
    if not args.plugin_only:
        subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "--prefix", str(source / "web"), "run", "build"], check=True)
        receipt = {"adapter_files": {relative: digest(source / relative) for relative in manifest["adapter_files"]}, "source_revision": subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip(), "plugin_files": {str(file.relative_to(home)): digest(file) for file in (home / "plugins/project-history").rglob("*") if file.is_file() and "__pycache__" not in file.parts}}
        receipt["dashboard_bundle"] = {str(file.relative_to(source)): digest(file) for file in (source / "hermes_cli/web_dist").rglob("*") if file.is_file()}
        if not (source / "hermes_cli/web_dist/index.html").is_file():
            raise SystemExit("Dashboard build did not produce its entrypoint. No compatibility receipt saved.")
        receipt_path = home / "plugin-data/project-history/install-compatibility.json"
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(json.dumps(receipt, indent=2))
    print("Installed. Run: hermes plugins enable project-history. Start a new chat.")
    print("For guarded dashboard startup, use launch_dashboard.py with the same --home and --source.")


if __name__ == "__main__":
    main()
