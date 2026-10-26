import type { Extraction } from "./extract";
import type {
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
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
