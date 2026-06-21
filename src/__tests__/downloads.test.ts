// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile } from "../lib/downloads";

describe("downloadTextFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates an object URL, clicks a download anchor, and revokes the URL", () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      click,
      set href(value: string) {
        expect(value).toBe("blob:test");
      },
      set download(value: string) {
        expect(value).toBe("molecules.csv");
      }
    } as unknown as HTMLAnchorElement);

    downloadTextFile("molecules.csv", "id,name", "text/csv");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
