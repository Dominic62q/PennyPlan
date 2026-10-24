import postgres from "postgres";

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Model calls across every user per UTC day: the one ceiling that protects the
// shared plan. A per-person limit exists in the database function but stays off
// until ASSISTANT_USER_DAILY_CALL_CAP is set.
const globalCap = () => num(process.env.ASSISTANT_DAILY_CALL_CAP, 3000);
const userCap = () => {
  const cap = Number(process.env.ASSISTANT_USER_DAILY_CALL_CAP);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
};

export class LimitError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 503,
  ) {
    super(message);
  }
}

// One small connection, kept across hot reloads. The counters sit behind row
// level security with no policies, so only this server connection can use them.
const globalForDb = globalThis as unknown as { assistantSql?: postgres.Sql };

function connection() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  globalForDb.assistantSql ??= postgres(url, { max: 1, prepare: false, idle_timeout: 20 });
  return globalForDb.assistantSql;
}

/** Counts one model call, or throws a LimitError when a daily cap is reached. */
export async function reserveCall(userId: string): Promise<void> {
  const [row] = await connection()<{ result: string }[]>`
    select public.reserve_assistant_call(${userId}::uuid, ${globalCap()}::int, ${userCap()}::int) as result`;
  if (row?.result === "global_cap") {
    throw new LimitError("Penny is at capacity for today. Try again tomorrow.", 503);
  }
  if (row?.result === "user_cap") {
    throw new LimitError("You've reached today's limit for Penny. Try again tomorrow.", 429);
  }
}

/** Best-effort token accounting after a successful call; never blocks the answer. */
export async function recordTokens(userId: string, totalTokens: number | undefined): Promise<void> {
  if (!totalTokens || totalTokens < 0) return;
  await connection()`
    select public.record_assistant_tokens(${userId}::uuid, ${Math.round(totalTokens)}::bigint)`;
}
