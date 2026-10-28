import type { ToolCall } from "@/lib/assistant/types";
import { visibleText } from "./opencode";

export type StreamedReply = {
  // Everything the model wrote, thinking tags included (the caller cleans it).
  raw: string;
  toolCalls: ToolCall[];
  tokens?: number;
  finish?: string;
};

type Frame = {
  error?: unknown;
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { total_tokens?: number } | null;
};

/**
 * Reads a chat-completions event stream to the end. `onText` gets each new piece of
 * the reply that is safe to show, as it arrives. Tool calls come in pieces and are
 * put back together here. Throws when the stream breaks or the provider sends an error.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onText: (more: string) => void,
): Promise<StreamedReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const pieces = new Map<number, { id: string; name: string; args: string }>();
  let buffer = "";
  let raw = "";
  let shown = 0;
  let tokens: number | undefined;
  let finish: string | undefined;

  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let frame: Frame;
    try {
      frame = JSON.parse(data) as Frame;
    } catch {
      return;
    }
    if (frame.error) throw new Error("upstream stream error");
    if (frame.usage?.total_tokens !== undefined) tokens = frame.usage.total_tokens;
    const choice = frame.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta;
    if (delta?.content) {
      raw += delta.content;
      const visible = visibleText(raw);
      // Once the model reaches for a tool, whatever it says around that is working
      // talk, not the answer: nothing more is shown.
      if (visible.length > shown && pieces.size === 0) {
        onText(visible.slice(shown));
        shown = visible.length;
      }
    }
    for (const part of delta?.tool_calls ?? []) {
      const index = part.index ?? 0;
      const piece = pieces.get(index) ?? { id: "", name: "", args: "" };
      if (part.id) piece.id = part.id;
      if (part.function?.name) piece.name += part.function.name;
      if (part.function?.arguments) piece.args += part.function.arguments;
      pieces.set(index, piece);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, newline).trimEnd());
      buffer = buffer.slice(newline + 1);
    }
  }
  handle(buffer.trim());

  const toolCalls: ToolCall[] = [...pieces.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, piece], i) => ({
      id: piece.id || `call_${i}`,
      type: "function" as const,
      function: { name: piece.name, arguments: piece.args },
    }));
  return { raw, toolCalls, tokens, finish };
}
