/**
 * Browser fallback for saving text. Inside the desktop app, exports are written to the workspace
 * by Rust instead — `<a download>` is unreliable in the webview.
 */
export function downloadTextFile(filename: string, content: string, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Firefox only dispatches the download for an anchor that is in the document, and revoking the
  // URL in the same tick can abort a download that has not started reading the blob yet.
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Quotes a CSV field and disarms spreadsheet formula injection, so an imported name such as
 * `=cmd|...` cannot execute when the export is opened in Excel.
 */
export function csvField(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvField).join(",")).join("\n");
}
