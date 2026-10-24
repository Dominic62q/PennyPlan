import { useQuery } from "@tanstack/react-query";
import { firstName, parseName } from "@/lib/auth/schema";
import { createClient } from "@/lib/supabase/client";

export const profileNameKey = ["profile", "name"] as const;

/** The stored display name (null until the person adds one) and their first name. */
export function useDisplayName() {
  const query = useQuery({
    queryKey: profileNameKey,
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await createClient().from("profiles").select("display_name").maybeSingle();
      return data?.display_name ?? null;
    },
  });
  return {
    ready: query.isSuccess,
    displayName: query.data ?? null,
    name: firstName(query.data),
  };
}

/** Saves the name; an empty value clears it. Returns what was stored. */
export async function saveDisplayName(value: string): Promise<string | null> {
  const trimmed = value.trim();
  let next: string | null = null;
  if (trimmed) {
    const parsed = parseName(trimmed);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Enter a valid name");
    next = parsed.data;
  }
  const supabase = createClient();
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("Sign in again to save your name.");
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: next })
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data?.length) throw new Error("Couldn't save your name.");
  return next;
}
