import type { Extraction } from "./extract";
import type {
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
  ChatMessage,
  ModelMessage,
} from "./types";

// Only what was actually said goes back to the model: not action lines, not
// error notices.
export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.flatMap((m): ModelMessage[] => {
    if (m.role === "user") return m.local ? [] : [{ role: "user", content: m.text }];
    return m.kind === "text" ? [{ role: "assistant", content: m.text }] : [];
  });
}

// A failure with a message that is fine to show the person as it is.
export class AssistantError extends Error {}

const today = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

/** One model step: Penny's next message, which may ask for tools. */
export async function askStep(
  messages: ModelMessage[],
  conversationId: string,
  options: { toolsEnabled: boolean; signal: AbortSignal },
): Promise<AssistantMessage> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body: AssistantRequest = {
    conversationId,
    messages,
    toolsEnabled: options.toolsEnabled,
    today: today(timeZone),
    timeZone,
  };

  let response: Response;
  try {
    response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new AssistantError("I couldn't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new AssistantError(
      typeof error === "string" ? error : "Something went wrong. Try again.",
    );
  }
  const { message } = (await response.json()) as AssistantResponse;
  return message;
}

/** Sends a receipt photo (a data URL) or pasted statement text to be read. */
export async function readDocument(
  input: { image: string } | { text: string },
  conversationId: string,
  signal: AbortSignal,
): Promise<{ extraction: Extraction; skipped: number }> {
  let response: Response;
  try {
    response = await fetch("/api/assistant/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId,
        today: today(Intl.DateTimeFormat().resolvedOptions().timeZone),
        ...input,
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AssistantError("I couldn't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new AssistantError(typeof error === "string" ? error : "Something went wrong. Try again.");
  }
  return (await response.json()) as { extraction: Extraction; skipped: number };
}
