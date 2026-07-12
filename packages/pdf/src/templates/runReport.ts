import { escapeHtml } from "../escapeHtml.js";
import { buildBannerTemplate, type ClassificationBannerInfo } from "./banner.js";
import { renderHtmlToPdf } from "../renderer.js";

export interface RunReportClassification {
  text: string;
  badgeBgColor: string;
  badgeTextColor: string;
}

export interface RunReportData {
  productName: string;
  primaryColor: string;
  banner: ClassificationBannerInfo;
  classification: RunReportClassification | null;
  jobName: string;
  runId: string;
  triggerType: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  computedCost: string | null;
  output: string | null;
  errorMessage: string | null;
}

function row(label: string, value: string): string {
  return `<tr><th style="text-align:left;padding:4px 12px 4px 0;color:#555;font-weight:600;white-space:nowrap;">${escapeHtml(
    label,
  )}</th><td style="padding:4px 0;">${value}</td></tr>`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZoneName: "short" });
}

// Builds the report body (not the header/footer banner — that's applied
// separately via Playwright's page.pdf() headerTemplate/footerTemplate,
// see renderRunReportPdf below). Every field here is either
// server-generated (IDs, timestamps, status enums) or admin/user text
// that must be HTML-escaped before interpolation — output and
// errorMessage in particular come from the LibreChat agent and are
// treated as fully untrusted.
export function buildRunReportHtml(data: RunReportData): string {
  const classificationBadge = data.classification
    ? `<div style="display:inline-block;margin-bottom:16px;padding:4px 10px;border-radius:3px;font-weight:700;font-size:11px;background-color:${escapeHtml(
        data.classification.badgeBgColor,
      )};color:${escapeHtml(data.classification.badgeTextColor)};">${escapeHtml(data.classification.text)}</div>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12px; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 4px 0; color: ${escapeHtml(data.primaryColor)}; }
      .subtitle { color: #666; margin-bottom: 16px; }
      table { border-collapse: collapse; margin-bottom: 20px; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f5f5f5; border-radius: 4px; padding: 12px; font-size: 11px; }
      .error { background: #fdecea; border: 1px solid #f5c6cb; color: #611a15; border-radius: 4px; padding: 12px; white-space: pre-wrap; word-break: break-word; }
      .section-title { font-size: 13px; font-weight: 700; margin: 20px 0 8px 0; }
    </style>
  </head>
  <body>
    ${classificationBadge}
    <div class="subtitle">${escapeHtml(data.productName)} — Run Report</div>
    <h1>${escapeHtml(data.jobName)}</h1>
    <table>
      ${row("Run ID", escapeHtml(data.runId))}
      ${row("Status", escapeHtml(data.status))}
      ${row("Trigger", escapeHtml(data.triggerType))}
      ${row("Created", escapeHtml(formatDate(data.createdAt)))}
      ${row("Started", escapeHtml(formatDate(data.startedAt)))}
      ${row("Completed", escapeHtml(formatDate(data.completedAt)))}
      ${
        data.promptTokens != null || data.completionTokens != null
          ? row("Tokens", escapeHtml(`${data.promptTokens ?? 0} prompt / ${data.completionTokens ?? 0} completion`))
          : ""
      }
      ${data.computedCost != null ? row("Cost", escapeHtml(`$${Number(data.computedCost).toFixed(4)}`)) : ""}
    </table>
    ${
      data.errorMessage
        ? `<div class="section-title">Error</div><div class="error">${escapeHtml(data.errorMessage)}</div>`
        : ""
    }
    ${data.output ? `<div class="section-title">Output</div><pre>${escapeHtml(data.output)}</pre>` : ""}
  </body>
</html>`;
}

// Convenience wrapper: builds the run report HTML and applies the
// classification banner as the PDF's header/footer in one call.
export async function renderRunReportPdf(data: RunReportData): Promise<Buffer> {
  const bannerTemplate = buildBannerTemplate(data.banner);
  return renderHtmlToPdf(buildRunReportHtml(data), {
    headerTemplate: bannerTemplate,
    footerTemplate: bannerTemplate,
  });
}
