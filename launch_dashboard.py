"""Refuse incompatible updates before starting the dashboard; never overwrite code."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")))
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("dashboard_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    home, source = args.home.resolve(), args.source.resolve()
    receipt_path = home / "plugin-data/project-history/install-compatibility.json"
    if not receipt_path.is_file():
        raise SystemExit("No verified dashboard adapter installation. Complete installation first.")
    receipt = json.loads(receipt_path.read_text())
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != receipt["source_revision"]:
        raise SystemExit("Hermes was updated. Review/test adapter compatibility before dashboard startup; your plugin and installation backup remain preserved.")
    for root, entries in ((source, receipt["adapter_files"]), (home, receipt["plugin_files"]), (source, receipt["dashboard_bundle"])):
        for relative, expected in entries.items():
            file = root / relative
            if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
                raise SystemExit("Integration changed or disappeared: " + relative + ". Review before startup; no code was overwritten.")
    if args.check_only:
        print("PASS: verified installation unchanged.")
        return
    env = dict(os.environ, HERMES_HOME=str(home))
    extra = args.dashboard_args
    if extra[:1] == ["--"]:
        extra = extra[1:]
    subprocess.run(["hermes.cmd" if os.name == "nt" else "hermes", "dashboard", *extra], env=env, check=True)


if __name__ == "__main__":
    main()
