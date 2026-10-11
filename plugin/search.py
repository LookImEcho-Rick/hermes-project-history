"""Search helper used through Hermes' existing terminal tool, with clickable evidence."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / "dashboard"))
from history import History, source_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", nargs="?", default="")
    parser.add_argument("--kind", choices=["all", "notebook", "report", "chat"], default="all")
    parser.add_argument("--home", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--dashboard-url", default="http://127.0.0.1:9119")
    args = parser.parse_args()
    store = History(args.home)
    if args.refresh:
        store.refresh()
    result = store.search(args.query, args.kind, args.limit)
    for item in result["results"]:
        item["url"] = source_url(item["id"], args.query, args.dashboard_url)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
