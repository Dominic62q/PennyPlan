import type { ChartSpec } from "./chart-spec";

// What a chat is made of. Every kind is plain data so a saved chat can be
// shown again.
export type ChatMessage =
  // `local` marks a line that only stands for a photo or pasted statement the
  // person handed over. The model sees it only through `digest`, the text of what
  // Penny read from the attachment, kept so she can still answer about it later.
  // `image` is a small preview of an attached photo, for showing the bubble again.
  | { id: string; role: "user"; text: string; local?: true; digest?: string; image?: string }
  // `trace` is the look-ups behind the answer (her requests and what the tools
  // returned), kept so a follow-up can build on them instead of asking again.
  | { id: string; role: "assistant"; kind: "text"; text: string; trace?: ModelMessage[] }
  | {
      id: string;
      role: "assistant";
      kind: "action";
      label: string;
      detail?: string;
      // Present while the change can still be reversed; `undone` once it has been.
      undoTokens?: string[];
      undone?: boolean;
    }
  // Asks before anything is deleted or added in bulk. Nothing happens until the
  // person taps the button.
  | ({
      id: string;
      role: "assistant";
      kind: "confirm";
      status: "pending" | "done" | "kept";
    } & Proposal)
  // What Penny read from a receipt or statement, open for editing. Nothing is saved
  // until the person taps Add.
  | ({ id: string; role: "assistant"; kind: "review" } & Review)
  // A chart, kept as the figures it was drawn from so a saved chat shows it again.
  | { id: string; role: "assistant"; kind: "chart"; chart: ChartSpec }
  // Something went wrong (signed out, over the limit, offline). Shown to the
  // person but never sent back to the model as if Penny had said it.
  | { id: string; role: "assistant"; kind: "notice"; text: string };

// Told to the screen whenever Penny changes something, so it can show the line.
export type ChangeNote = { label: string; detail?: string; undoTokens?: string[] };

// One transaction on a confirm card, already formatted for reading.
export type ConfirmRow = { id: string; title: string; detail: string; amount: string };

// An entry waiting on a bulk-add card: validated, in minor units, ready to save.
export type NewEntry = {
  type: "expense" | "income";
  amount: number;
  accountId: string;
  categoryId: string | null;
  payee: string | null;
  note: string | null;
  date: string; // YYYY-MM-DD
};

// One line on a review card. Everything is held as the text the person sees and
// edits; it is checked and turned into a NewEntry only when they confirm.
export type ReviewRow = {
  id: string;
  include: boolean;
  type: "expense" | "income";
  date: string; // YYYY-MM-DD
  payee: string;
  amount: string; // "45.50"
  categoryId: string | null;
  // Same account, day, kind and amount already exists. Left out until the person opts in.
  duplicate: boolean;
};

export type Review = {
  status: "pending" | "done" | "kept";
  source: "receipt" | "statement";
  accountId: string;
  // The currency the document used, when it said; an account in another one can't be chosen.
  currency: string | null;
  rows: ReviewRow[];
  // Saved with a receipt's entry: what was bought.
  note: string | null;
  // Plain warnings (items that don't add up, lines that couldn't be read).
  warnings: string[];
};

// Penny asks the screen to put a confirm card in front of the person.
export type Proposal =
  | { action: "delete"; rows: ConfirmRow[] }
  | { action: "add"; rows: ConfirmRow[]; entries: NewEntry[]; summary: string };

// What goes over the wire to the model, one step at a time.
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ModelMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type AssistantRequest = {
  conversationId: string;
  messages: ModelMessage[];
  // False on the last allowed step, so the model has to answer in words.
  toolsEnabled: boolean;
  today: string; // YYYY-MM-DD in the person's time zone
  timeZone: string;
  userName?: string;
};

export type AssistantMessage = Extract<ModelMessage, { role: "assistant" }>;
export type AssistantResponse = { message: AssistantMessage };
