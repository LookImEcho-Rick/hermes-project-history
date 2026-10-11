"""User-owned evidence search, source preview and inline image tools."""


def register(ctx):
    """The dashboard discovers its manifest independently; tools use the native API."""
    from .image_tool import IMAGE_SCHEMA, SEARCH_SCHEMA, IMAGE_SEARCH_SCHEMA, display_images, project_history_search, search_images
    from functools import partial
    ctx.register_tool(name="display_images", toolset="project_history", schema=IMAGE_SCHEMA,
                      handler=display_images, description=IMAGE_SCHEMA["description"], emoji="🖼️")
    ctx.register_tool(name="project_history_search", toolset="project_history", schema=SEARCH_SCHEMA,
                      handler=partial(project_history_search, dashboard_base=ctx.get_config("dashboard_url", "http://127.0.0.1:9119")), description=SEARCH_SCHEMA["description"], emoji="📚")
    ctx.register_tool(name="search_images", toolset="project_history", schema=IMAGE_SEARCH_SCHEMA,
                      handler=search_images, description=IMAGE_SEARCH_SCHEMA["description"], emoji="🔎")
