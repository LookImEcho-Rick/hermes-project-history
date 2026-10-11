# Project history and inline images

This is a user-owned native Hermes plugin. It lives outside the Hermes source
checkout and registers `project_history_search`, `search_images` and
`display_images`. Enable with `hermes plugins enable project-history`, then start
a new chat. Its dashboard manifest provides the Project History page, source
preview and per-conversation image gallery.

The local index/gallery lives in `plugin-data/project-history`; displayed local
images are preserved in `cache/images/project-history`. Original Markdown and
chat databases are read-only. Search uses keywords and explicit refresh. Default
documents are project notebooks. The Local AI folder layout additionally indexes
reports/benchmarks/results, excluding source recovery and isolated profiles.

Remote image cards load directly from public hosts when the chat is viewed.
Captions and attribution remain visible if a host cannot load. Image display
does not generate artwork. Dashboard URL for citations is configurable using
the native `plugins.entries.project-history.settings.dashboard_url` setting.

The dashboard integration requires terminal link activation, plugin slot context,
and the read-only current-conversation endpoint. Local AI launcher startup checks
the integration and rebuilds after relevant changes; incompatible updates stop
with an explanation and retained recovery files. Direct dashboard starts bypass
the launcher check. Future updates cannot be guaranteed compatible.

A separately packaged installer, narrow adapter, checks and instructions are
maintained as a public distribution. Do not include plugin-data, image caches,
configuration, conversations or private notebooks in that distribution.
