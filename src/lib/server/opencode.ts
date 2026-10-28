// Shared by the routes that talk to the model provider.

export const baseUrl = () =>
  (process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go").replace(/\/+$/, "");

export const chatModel = () => process.env.OPENCODE_MODEL || "deepseek-v4.1-flash";

// Reading photos can use a different model from chatting; it falls back to the chat one.
export const visionModel = () => process.env.OPENCODE_VISION_MODEL || chatModel();

export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

// How much of a half-written reply is safe to show: finished thinking blocks are gone,
// an unfinished one and a half-typed "<thi" are held back. Only ever grows as text arrives.
export function visibleText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = text.search(/<think>/i);
  if (open >= 0) text = text.slice(0, open);
  else text = text.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, "");
  return text.trimStart();
}
