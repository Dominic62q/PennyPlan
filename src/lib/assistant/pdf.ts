import { AssistantError } from "./client";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 30;
const MAX_EDGE = 2_000;
// Fewer characters than this on the pages means a scan, not a real text PDF.
const MIN_TEXT_CHARS = 60;

export type PdfInput =
  // A PDF with real text: the rows are read from the words themselves.
  | { text: string }
  // A scan: only the first page can be read, as a picture.
  | { image: string; firstPageOnly: true };

type TextPiece = { str: string; transform: number[]; hasEOL?: boolean };

// Words come out of a PDF as loose pieces with positions. Pieces on the same
// baseline become one line, with a gap between columns, so a statement row
// stays a row.
function linesOf(pieces: TextPiece[]) {
  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;
  for (const piece of pieces) {
    if (!("transform" in piece)) continue;
    const y = piece.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 3) {
      lines.push(current);
      current = "";
    }
    if (piece.str) current += current && !current.endsWith(" ") ? `  ${piece.str}` : piece.str;
    lastY = y;
  }
  lines.push(current);
  return lines.map((l) => l.trim()).filter(Boolean);
}

/** Reads a PDF in the browser: its text when it has some, else page one as a picture. */
export async function readPdf(file: File): Promise<PdfInput> {
  if (file.size > MAX_FILE_BYTES) throw new AssistantError("That PDF is too large. Try a smaller one.");

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    void task.destroy();
    const name = (error as { name?: string }).name;
    throw new AssistantError(
      name === "PasswordException"
        ? "That PDF is password protected. Open it, then send a screenshot or the text."
        : "I couldn't open that PDF. Try a photo or the pasted text instead.",
    );
  }

  try {
    if (doc.numPages > MAX_PAGES) {
      throw new AssistantError(`That PDF has ${doc.numPages} pages. Send ${MAX_PAGES} or fewer at a time.`);
    }
    const lines: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      lines.push(...linesOf(content.items as TextPiece[]));
    }
    const text = lines.join("\n");
    if (text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) return { text };

    // No text layer: draw the first page and let the picture reader have it.
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, MAX_EDGE / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AssistantError("I couldn't process that PDF.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return { image: canvas.toDataURL("image/jpeg", 0.85), firstPageOnly: true };
  } finally {
    void task.destroy();
  }
}
