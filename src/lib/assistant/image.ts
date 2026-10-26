import { AssistantError } from "./client";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 2_000;
const PREVIEW_EDGE = 360;

/**
 * Turns a picked photo into a smaller JPEG data URL for reading. Phone photos are
 * several megabytes; a receipt stays legible at 2000 pixels on the long side.
 * `preview` makes a thumbnail instead, small enough to keep in the saved chat.
 */
export async function imageToDataUrl(file: File, preview = false): Promise<string> {
  if (!file.type.startsWith("image/")) throw new AssistantError("Choose a photo or a screenshot.");
  if (file.size > MAX_FILE_BYTES) throw new AssistantError("That photo is too large. Try a smaller one.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new AssistantError("I couldn't open that image. Try a JPEG or PNG.");
  }

  const scale = Math.min(1, (preview ? PREVIEW_EDGE : MAX_EDGE) / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AssistantError("I couldn't process that image.");
  // JPEG has no transparency; a transparent screenshot would turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", preview ? 0.6 : 0.85);
}
