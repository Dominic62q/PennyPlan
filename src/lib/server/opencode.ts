// Shared by the routes that talk to the model provider.

export const baseUrl = () =>
  (process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go").replace(/\/+$/, "");

export const chatModel = () => process.env.OPENCODE_MODEL || "deepseek-v4.1-flash";

// Reading photos can use a different model from chatting; it falls back to the chat one.
export const visionModel = () => process.env.OPENCODE_VISION_MODEL || chatModel();

export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
