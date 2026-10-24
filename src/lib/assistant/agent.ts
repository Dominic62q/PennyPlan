import type { QueryClient } from "@tanstack/react-query";
import { AssistantError, askStep, toModelMessages } from "./client";
import type { ChartSpec } from "./chart-spec";
import { runTool, type ToolContext } from "./tools";
import type { ChangeNote, ChatMessage, ModelMessage, Proposal } from "./types";

// Each step is one trip to the model. Penny may ask for tools, we run them here
// as the signed-in person, hand back the results and let her carry on, until
// she answers in words or runs out of steps.
export const MAX_STEPS = 8;

// A short plain phrase for each kind of look-up, never the inner details.
const PHRASES: Record<string, string> = {
  get_overview: "Checking your overview",
  list_accounts: "Checking your accounts",
  list_categories: "Checking your categories",
  find_transactions: "Checking your transactions",
  summarize_spending: "Checking your spending",
  show_chart: "Drawing that chart",
  list_budgets: "Checking your budgets",
  set_budget: "Setting that budget",
  remove_budget: "Removing that budget",
  create_account: "Creating that account",
  update_account: "Updating that account",
  create_category: "Creating that category",
  update_category: "Updating that category",
  list_bills: "Checking your bills",
  create_bill: "Adding that bill",
  update_bill: "Updating that bill",
  pay_bill: "Marking that paid",
  skip_bill: "Skipping that one",
  transfer_money: "Moving that money",
  add_transaction: "Saving that",
  update_transaction: "Updating that",
  propose_transactions: "Lining those up",
  delete_transactions: "Lining that up",
  set_my_name: "Noting your name",
};

export const THINKING_PHRASE = "Thinking";
export const READING_PHRASE = "Reading your document";
export const FINISHING_PHRASE = "Putting it together";

export async function runAgent({
  history,
  conversationId,
  queryClient,
  signal,
  onPhrase,
  onChange,
  onProposal,
  onChart,
}: {
  history: ChatMessage[];
  conversationId: string;
  queryClient: QueryClient;
  signal: AbortSignal;
  onPhrase: (phrase: string) => void;
  // Called for each change Penny makes, as it happens.
  onChange?: (note: ChangeNote) => void;
  // Called when Penny wants the person to confirm something.
  onProposal?: (proposal: Proposal) => void;
  // Called when Penny draws a chart.
  onChart?: (chart: ChartSpec) => void;
}): Promise<string> {
  const messages: ModelMessage[] = toModelMessages(history);
  // One shared tally for the whole question, so the limits on changes hold.
  const context: ToolContext = { queryClient, onChange, onProposal, onChart };
  onPhrase(THINKING_PHRASE);

  for (let step = 1; step <= MAX_STEPS; step++) {
    // On the last step she can't ask for more, so she has to answer.
    const reply = await askStep(messages, conversationId, {
      toolsEnabled: step < MAX_STEPS,
      signal,
    });

    if (!reply.tool_calls?.length) {
      const text = reply.content?.trim();
      if (!text) throw new AssistantError("Penny didn't have an answer. Try asking again.");
      return text;
    }

    messages.push(reply);
    onPhrase(PHRASES[reply.tool_calls[0].function.name] ?? THINKING_PHRASE);
    for (const call of reply.tool_calls) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const content = await runTool(context, call.function.name, call.function.arguments);
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
    onPhrase(FINISHING_PHRASE);
  }

  throw new AssistantError("That took too many steps. Try a simpler question.");
}
