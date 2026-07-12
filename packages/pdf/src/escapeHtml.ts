// Every value interpolated into a report template must pass through
// this — report content includes LibreChat agent output, which is
// untrusted text as far as this renderer is concerned. Rendering it
// unescaped into a real Chromium page (via Playwright) would be an HTML/
// script injection vector, not just a display bug.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
