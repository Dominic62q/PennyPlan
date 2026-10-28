// A brand mark for a category or bill (Spotify, Netflix, ...). Either a one-colour
// glyph, kept as the path of a 24x24 SVG so it takes the tile's own colour, or a
// small PNG (as a data URL) from the brand's website for brands the glyph set lacks.
// Stored beside the row; the row's normal icon stays underneath as the fallback.
export type Logo = {
  title: string;
  path?: string;
  image?: string;
};

// What a stored logo may contain. The database enforces the same shapes.
export const LOGO_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,eE+-]+$/;
export const MAX_LOGO_PATH = 60_000;
export const LOGO_IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_LOGO_IMAGE = 20_100;

export function parseLogo(value: unknown): Logo | null {
  if (!value || typeof value !== "object") return null;
  const { title, path, image } = value as Record<string, unknown>;
  if (typeof title !== "string" || !title || title.length > 80) return null;
  if (typeof path === "string" && path.length <= MAX_LOGO_PATH && LOGO_PATH.test(path)) return { title, path };
  if (typeof image === "string" && image.length <= MAX_LOGO_IMAGE && LOGO_IMAGE.test(image)) return { title, image };
  return null;
}
