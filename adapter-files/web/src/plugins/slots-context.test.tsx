// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PluginSlot, registerSlot, unregisterPluginSlots } from "./slots";

describe("page-owned plugin context", () => {
  it("passes current context to a slot and updates it when the conversation changes", async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const div = document.createElement("div");
    const root = createRoot(div);
    function Widget(props: Record<string, unknown>) { return <span>{String(props.sessionId)}</span>; }
    registerSlot("context-fixture", "chat:bottom", Widget);
    try {
      await act(async () => root.render(<PluginSlot name="chat:bottom" context={{ sessionId: "first" }} />));
      expect(div.textContent).toBe("first");
      await act(async () => root.render(<PluginSlot name="chat:bottom" context={{ sessionId: "second" }} />));
      expect(div.textContent).toBe("second");
    } finally { await act(async () => root.unmount()); unregisterPluginSlots("context-fixture"); }
  });
});
