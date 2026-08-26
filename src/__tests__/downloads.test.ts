// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { csvField, downloadTextFile, toCsv } from "../lib/downloads";

describe("downloadTextFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks an anchor that is in the document, and revokes the URL only afterwards", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const anchor = document.createElement("a");
    const click = vi.spyOn(anchor, "click").mockImplementation(() => {
      // Firefox ignores a click on a detached anchor, so it has to be in the document by now.
      expect(anchor.isConnected).toBe(true);
    });
    vi.spyOn(document, "createElement").mockReturnValue(anchor);

    downloadTextFile("molecules.csv", "id,name", "text/csv");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchor.getAttribute("download")).toBe("molecules.csv");
    // Revoking in the same tick can abort a download that has not read the blob yet.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(anchor.isConnected).toBe(false);
  });
});

describe("csvField", () => {
  it("quotes and escapes ordinary values", () => {
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvField(null)).toBe('""');
    expect(csvField(46.069)).toBe('"46.069"');
  });

  it("disarms spreadsheet formulas so an imported name cannot execute in Excel", () => {
    expect(csvField("=cmd|'/c calc'!A1")).toBe(`"'=cmd|'/c calc'!A1"`);
    expect(csvField("+1234")).toBe(`"'+1234"`);
    expect(csvField("-lead")).toBe(`"'-lead"`);
    expect(csvField("@import")).toBe(`"'@import"`);
  });

  it("leaves a normal molecule name untouched", () => {
    expect(toCsv([["name"], ["ZDDP-Chain-Ester-01"]])).toBe('"name"\n"ZDDP-Chain-Ester-01"');
  });
});
