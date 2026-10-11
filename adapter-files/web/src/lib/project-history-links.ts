/** A narrow bridge from terminal URLs to the user-owned source-preview plugin. */
export function openProjectHistoryLink(uri: string): boolean {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  const base = window.__HERMES_BASE_PATH__ || "";
  if (url.origin !== window.location.origin || url.pathname !== `${base}/project-history`) return false;
  const id = url.searchParams.get("source") || "";
  if (!/^[a-f0-9]{32}$/.test(id)) return false;
  const event = new CustomEvent("local-ai:open-source", { cancelable: true, detail: { id, query: (url.searchParams.get("q") || "").slice(0, 300) } });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function activateTerminalLink(_event: MouseEvent, uri: string): void {
  if (!openProjectHistoryLink(uri)) window.open(uri, "_blank", "noopener,noreferrer");
}
