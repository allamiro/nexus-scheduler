import { chromium } from "playwright";

export interface PdfRenderOptions {
  headerTemplate?: string;
  footerTemplate?: string;
}

const RENDER_TIMEOUT_MS = 30_000;

// N concurrent /render/* calls used to spawn N headless Chromium
// processes (~100-300MB each) with no ceiling — a handful of concurrent
// requests was enough to OOM-kill the pod. Capping in-flight renders and
// queuing the rest bounds worst-case memory to a known multiple instead
// of scaling with whatever request volume happens to arrive.
const MAX_CONCURRENT_RENDERS = 3;
let activeRenders = 0;
const renderQueue: Array<() => void> = [];

function acquireRenderSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeRenders < MAX_CONCURRENT_RENDERS) {
      activeRenders++;
      resolve();
    } else {
      renderQueue.push(resolve);
    }
  });
}

function releaseRenderSlot(): void {
  const next = renderQueue.shift();
  if (next) {
    next(); // hands the slot directly to the next waiter — activeRenders stays unchanged
  } else {
    activeRenders--;
  }
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
  await acquireRenderSlot();
  try {
    const browser = await chromium.launch({ args: ["--no-sandbox"], timeout: RENDER_TIMEOUT_MS });
    try {
      const page = await browser.newPage();
      // page.pdf() itself takes no per-call timeout — this default
      // applies to every subsequent action on the page, including it.
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
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
  } finally {
    releaseRenderSlot();
  }
}
