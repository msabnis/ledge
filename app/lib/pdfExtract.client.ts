/**
 * Browser-only PDF text extraction, ported from the original Tatsatiti Ledger.
 * The ".client.ts" suffix tells Remix/Vite to exclude this from the server
 * bundle — it uses FileReader and loads pdf.js from a CDN, neither of which
 * exist server-side. Output feeds straight into parseSupplierInvoiceText().
 */

const PDFJS_SCRIPT_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

const loadedScripts = new Set<string>();

function loadScriptOnce(src: string, timeoutMs = 10000): Promise<void> {
  if (loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    const timer = setTimeout(() => reject(new Error(`Timed out loading ${src}`)), timeoutMs);
    script.onload = () => {
      clearTimeout(timer);
      loadedScripts.add(src);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Reconstruct reading-order text from a pdf.js page's text content, clustering
 * items into lines by y-position and ordering left-to-right within each line
 * (mirrors how server-side PDF text extractors read tables).
 */
function pdfPageToText(items: any[]): string {
  const pts = items
    .map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str }))
    .filter((p) => p.str !== undefined);
  pts.sort((a, b) => b.y - a.y || a.x - b.x);
  const TOL = 2.5;
  const lines: { y: number; items: typeof pts }[] = [];
  let current: { y: number; items: typeof pts } | null = null;
  pts.forEach((p) => {
    if (current && Math.abs(p.y - current.y) <= TOL) {
      current.items.push(p);
    } else {
      current = { y: p.y, items: [p] };
      lines.push(current);
    }
  });
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")).join("\n");
}

export async function extractPdfText(file: File): Promise<string> {
  await loadScriptOnce(PDFJS_SCRIPT_SRC);
  if (typeof window.pdfjsLib === "undefined") {
    throw new Error("PDF reader library did not load on this network. Try reloading, or use the paste-text option.");
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  const buf = await readFileAsArrayBuffer(file);
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const pageTexts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pageTexts.push(pdfPageToText(content.items));
  }
  return pageTexts.join("\n");
}
