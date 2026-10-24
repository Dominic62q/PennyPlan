import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, ChatMessage, ModelMessage } from "@/lib/assistant/types";

const askStep = vi.fn<
  (
    messages: ModelMessage[],
    id: string,
    options: { toolsEnabled: boolean; signal: AbortSignal },
  ) => Promise<AssistantMessage>
>();
const runTool = vi.fn<(c: unknown, name: string, args: string) => Promise<string>>();

vi.mock("@/lib/assistant/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assistant/client")>()),
  askStep: (...args: Parameters<typeof askStep>) => askStep(...args),
}));
vi.mock("@/lib/assistant/tools", () => ({
  runTool: (...args: Parameters<typeof runTool>) => runTool(...args),
}));

import { MAX_STEPS, runAgent } from "@/lib/assistant/agent";
import { AssistantError } from "@/lib/assistant/client";

const history: ChatMessage[] = [
  { id: "1", role: "user", text: "How much did I spend this month?" },
];

const asksFor = (...names: string[]): AssistantMessage => ({
  role: "assistant",
  content: null,
  tool_calls: names.map((name, i) => ({
    id: `call_${name}_${i}`,
    type: "function",
    function: { name, arguments: "{}" },
  })),
});
const says = (content: string): AssistantMessage => ({ role: "assistant", content });

const start = (
  signal = new AbortController().signal,
  onPhrase: (phrase: string) => void = () => {},
) =>
  runAgent({
    history,
    conversationId: "chat-1234567890",
    queryClient: new QueryClient(),
    signal,
    onPhrase,
  });

beforeEach(() => {
  askStep.mockReset();
  runTool.mockReset();
  runTool.mockResolvedValue('{"ok":true}');
});

describe("runAgent", () => {
  it("answers straight away when no tools are needed", async () => {
    askStep.mockResolvedValueOnce(says("Hello!"));
    expect(await start()).toBe("Hello!");
    expect(runTool).not.toHaveBeenCalled();
  });

  it("runs the tools asked for and sends the results back before she answers", async () => {
    askStep
      .mockResolvedValueOnce(asksFor("get_overview", "list_accounts"))
      .mockResolvedValueOnce(says("You spent GH₵1,200.00."));
    const phrases: string[] = [];
    expect(await start(undefined, (p) => void phrases.push(p))).toBe("You spent GH₵1,200.00.");

    expect(runTool.mock.calls.map((c) => c[1])).toEqual(["get_overview", "list_accounts"]);
    // The second step sees the question, her request and both results, in order.
    const second = askStep.mock.calls[1][0];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(second[2]).toMatchObject({ role: "tool", tool_call_id: "call_get_overview_0" });
    expect(phrases).toEqual(["Thinking", "Checking your overview", "Putting it together"]);
  });

  it("only offers tools until the last step, then makes her answer", async () => {
    askStep.mockImplementation(async (_m, _id, { toolsEnabled }) =>
      toolsEnabled ? asksFor("list_accounts") : says("That's all I could find."),
    );
    expect(await start()).toBe("That's all I could find.");
    expect(askStep).toHaveBeenCalledTimes(MAX_STEPS);
    expect(askStep.mock.calls.map((c) => c[2].toolsEnabled)).toEqual([
      ...Array(MAX_STEPS - 1).fill(true),
      false,
    ]);
  });

  it("keeps earlier chat but not action lines or notices", async () => {
    askStep.mockResolvedValueOnce(says("ok"));
    await runAgent({
      history: [
        { id: "1", role: "user", text: "hi" },
        { id: "2", role: "assistant", kind: "text", text: "Hello" },
        { id: "3", role: "assistant", kind: "notice", text: "Offline" },
        { id: "4", role: "assistant", kind: "action", label: "Added" },
        { id: "5", role: "user", text: "again" },
      ],
      conversationId: "chat-1234567890",
      queryClient: new QueryClient(),
      signal: new AbortController().signal,
      onPhrase: () => {},
    });
    expect(askStep.mock.calls[0][0]).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "again" },
    ]);
  });

  it("stops running tools once the person has pressed Stop", async () => {
    const controller = new AbortController();
    askStep.mockResolvedValueOnce(asksFor("get_overview", "list_accounts"));
    runTool.mockImplementation(async () => {
      controller.abort();
      return "{}";
    });
    await expect(start(controller.signal)).rejects.toThrow();
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it("passes a model failure up with its message, and complains about an empty answer", async () => {
    askStep.mockRejectedValueOnce(new AssistantError("Penny is at capacity for today."));
    await expect(start()).rejects.toThrow("Penny is at capacity for today.");
    askStep.mockResolvedValueOnce(says("   "));
    await expect(start()).rejects.toBeInstanceOf(AssistantError);
  });
});
