# Hermes Project History & Image Preview

A user-owned Hermes plugin for searching project notebooks and past conversations,
opening evidence in a formatted side preview, and showing pictures inside the chat
interface without opening each image link.

## Features

- `project_history_search`: local keyword search with clickable evidence links.
- `search_images`: find existing Wikimedia Commons pictures and display them with attribution.
- `display_images`: show public image URLs or approved local PNG/JPEG/WebP/GIF files.
- Project History page and formatted source preview with nearby chat exchanges.
- Conversation-specific image cards below the native terminal and optional enlargement.

Hermes' conversation remains the native terminal interface. This package displays
existing images; creating artwork needs a separate image generation tool. Remote
images contact their public host when viewed.

## Installation

Requires a working Hermes source installation with its native agent/dashboard
plugin framework (SDK 1.1), Git, Node/npm and Python 3.10+. Dashboard dependencies
must already be installed. `release.json` records the tested Hermes commit.
Install while Hermes is stopped or idle, with a backup available.

```sh
python install.py --home /path/to/hermes-home --source /path/to/hermes-agent --check-only
python install.py --home /path/to/hermes-home --source /path/to/hermes-agent
hermes plugins enable project-history
python launch_dashboard.py --home /path/to/hermes-home --source /path/to/hermes-agent -- --no-open
```

On Windows quote paths and use the Python and Node/npm environment provided by
Hermes. The installer copies the plugin to `plugins/project-history` and the
instruction skill to `skills/note-taking/project-history` inside the selected
home, checks/applies the narrow adapter and builds the dashboard. Different
existing plugin/skill files are refused for review. Adapter originals are saved
under `plugin-data/project-history/install-backups`.

`--plugin-only` installs the tools/search page without dashboard changes.
Inline chat images and terminal-link interception require the adapter. Enable
the plugin in the selected home/profile, then start a new conversation.

For another dashboard port or proxy base path, set native plugin setting
`plugins.entries.project-history.settings.dashboard_url` to the full dashboard
base URL (default `http://127.0.0.1:9119`).

## Try it

“Find a picture of a red panda and show it here.”

“Why did we disable MTP? Search my project history and link the source.”

“Display this local image in our chat.”

Sources are Markdown in `workspace/project-notebooks` and the active home's
chat database. The documented Local AI layout also includes Documents,
Inference/benchmarks and ToolSuite/Results. Archives, recovery checkouts and
isolated test profiles are excluded. Search uses keywords; refresh after sources
change. Deleted/replaced source sections can invalidate previous links.

## Updates and recovery

The plugin lives outside Hermes' source checkout. Three small dashboard seams
are packaged separately: terminal URL activation, context passed to plugin slots,
and a read-only endpoint identifying the actual terminal conversation.

Use `launch_dashboard.py` for guarded startup. It refuses a changed Hermes
revision or changed/missing adapter/plugin files. It never blindly reapplies
patches or replaces source. Direct `hermes dashboard` starts bypass this check.
Future versions need compatibility review; no universal update guarantee.

Keep installer backups and inspect the narrow Git diff before reverting an
adapter. Preserve unrelated source changes. Local indexing/gallery metadata
lives in `plugin-data/project-history`, separate from the original `state.db`.
Local displayed images are copied into `cache/images/project-history`; include
these directories in backups.

## Development

The release has prebuilt JS/CSS. Python uses the standard library plus FastAPI
and native APIs already supplied by Hermes. UI editing:

```sh
cd plugin/dashboard
npm install
npm run check
npm test
npm run build
```

Backend checks: `python -m unittest discover -s tests -v`. The adapter includes
native tests for ChatPage, project-history-links and slots-context. Run the
existing Hermes web typecheck and those Vitest tests before accepting an update.
Installation success alone does not verify a model selects the tool or that a
third-party picture loads in your browser.

Public package contains code and synthetic fixtures only: no conversations,
credentials, personal notebooks, model weights or runtime dependencies.
