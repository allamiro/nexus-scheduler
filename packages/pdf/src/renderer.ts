import { chromium } from "playwright";

export interface PdfRenderOptions {
  headerTemplate?: string;
  footerTemplate?: string;
}

// Renders a self-contained HTML document to a PDF buffer with headless
// Chromium (REQUIREMENTS §2.5's recommended engine). A browser is
// launched fresh per call rather than pooled: reports are generated on
// demand from already-persisted data, so render volume is low and
// simplicity wins over the operational complexity of a shared pool.
//
// `--no-sandbox` is required for Chromium's own process sandbox to start
// under the restricted namespaces typical of a container running as a
// non-root user; the tradeoff is acceptable here specifically because
// the page only ever loads a `page.setContent()` string this same
// process built (never a remote or user-supplied URL) and the renderer
// has no network egress, so there is nothing external to sandbox against.
export async function renderHtmlToPdf(html: string, options: PdfRenderOptions = {}): Promise<Buffer> {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const hasHeaderFooter = Boolean(options.headerTemplate || options.footerTemplate);
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: hasHeaderFooter,
      headerTemplate: options.headerTemplate ?? "<span></span>",
      footerTemplate: options.footerTemplate ?? "<span></span>",
      margin: {
        top: options.headerTemplate ? "70px" : "30px",
        bottom: options.footerTemplate ? "70px" : "30px",
        left: "30px",
        right: "30px",
      },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
