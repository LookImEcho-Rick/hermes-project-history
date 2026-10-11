// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateTerminalLink, openProjectHistoryLink } from "./project-history-links";

afterEach(() => { vi.restoreAllMocks(); window.__HERMES_BASE_PATH__ = ""; });
describe("project evidence links", () => {
  it("opens a matching source in the mounted preview without leaving the conversation", () => {
    const receive = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener("local-ai:open-source", receive);
    const external = vi.spyOn(window, "open").mockReturnValue(null);
    activateTerminalLink({} as MouseEvent, `${window.location.origin}/project-history?source=${"a".repeat(32)}&q=MTP`);
    expect(receive).toHaveBeenCalledOnce();
    expect((receive.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: "a".repeat(32), query: "MTP" });
    expect(external).not.toHaveBeenCalled();
    window.removeEventListener("local-ai:open-source", receive);
  });
  it("preserves normal URLs, rejects foreign origins and falls back when the plugin is unavailable", () => {
    const external = vi.spyOn(window, "open").mockReturnValue(null);
    const local = `${window.location.origin}/project-history?source=${"b".repeat(32)}`;
    activateTerminalLink({} as MouseEvent, local);
    expect(external).toHaveBeenCalledWith(local, "_blank", "noopener,noreferrer");
    expect(openProjectHistoryLink(`https://example.org/project-history?source=${"b".repeat(32)}`)).toBe(false);
    expect(openProjectHistoryLink(`${window.location.origin}/project-history?source=../secrets`)).toBe(false);
    expect(openProjectHistoryLink("not a url")).toBe(false);
  });
  it("handles a prefixed dashboard and bounds the search term", () => {
    window.__HERMES_BASE_PATH__ = "/hermes";
    const receive = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener("local-ai:open-source", receive);
    expect(openProjectHistoryLink(`${window.location.origin}/hermes/project-history?source=${"c".repeat(32)}&q=${"x".repeat(400)}`)).toBe(true);
    expect((receive.mock.calls[0][0] as CustomEvent).detail.query).toHaveLength(300);
    window.removeEventListener("local-ai:open-source", receive);
  });
});
