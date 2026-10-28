import type { Extraction } from "./extract";
import type {
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
  AssistantStreamEvent,
  ModelMessage,
} from "./types";

// A failure with a message that is fine to show the person as it is.
export class AssistantError extends Error {}

// The photo or text held no receipt or statement (as opposed to a failure).
export class NothingToReadError extends AssistantError {}

const today = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

/** One model step: Penny's next message, which may ask for tools. */
export async function askStep(
  messages: ModelMessage[],
  conversationId: string,
  options: {
    toolsEnabled: boolean;
    signal: AbortSignal;
    // Gets the new words of the answer as they are written.
    onText?: (more: string) => void;
  },
): Promise<AssistantMessage> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body: AssistantRequest = {
    conversationId,
    messages,
    toolsEnabled: options.toolsEnabled,
    today: today(timeZone),
    timeZone,
    stream: true,
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
  if (!response.headers.get("content-type")?.includes("ndjson") || !response.body) {
    const { message } = (await response.json()) as AssistantResponse;
    return message;
  }

  // One JSON event per line: new words, then `done` with the whole message.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let message: AssistantMessage | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: AssistantStreamEvent;
    try {
      event = JSON.parse(line) as AssistantStreamEvent;
    } catch {
      return;
    }
    if (event.type === "text") options.onText?.(event.text);
    else if (event.type === "done") message = event.message;
    else if (event.type === "error") throw new AssistantError(event.error);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    handle(buffer);
  } catch (error) {
    if (error instanceof AssistantError || options.signal.aborted) throw error;
    throw new AssistantError("I lost the connection while Penny was answering. Try again.");
  }
  if (!message) throw new AssistantError("Penny's answer got cut off. Try again.");
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
    const message = typeof error === "string" ? error : "Something went wrong. Try again.";
    throw response.status === 422 ? new NothingToReadError(message) : new AssistantError(message);
  }
  return (await response.json()) as { extraction: Extraction; skipped: number };
}

/**
 * Has a photo or screenshot described in words (everything legible, copied out), so
 * Penny can keep it in mind for the rest of the chat. Returns that text.
 */
export async function describeImage(
  image: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/assistant/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId,
        today: today(Intl.DateTimeFormat().resolvedOptions().timeZone),
        image,
        describe: true,
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
  const { digest } = (await response.json()) as { digest: string };
  return digest;
}
