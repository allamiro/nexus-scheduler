import { escapeHtml } from "../escapeHtml.js";

export interface ClassificationBannerInfo {
  text: string;
  backgroundColor: string;
  textColor: string;
}

// The system-wide classification banner (§6), rendered identically top
// and bottom — same content the web UI shows in `ClassificationBanner`,
// carried onto every page of the PDF so marking travels with the
// document once it leaves the browser (§2.5). Playwright's header/
// footer templates run in an isolated context with no external
// stylesheet, so every style has to be inline.
export function buildBannerTemplate(banner: ClassificationBannerInfo): string {
  return `<div style="width:100%;font-size:9px;font-weight:700;text-align:center;padding:6px 0;background-color:${escapeHtml(
    banner.backgroundColor,
  )};color:${escapeHtml(banner.textColor)};">${escapeHtml(banner.text)}</div>`;
}
