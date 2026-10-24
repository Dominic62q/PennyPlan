import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address"));

// 72 is the most characters the password hash uses.
export const newPasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use 72 characters or fewer");

export const passwordSchema = z.string().min(1, "Enter your password");

// What Penny calls the person: letters and the usual name punctuation only, so
// it can safely be shown back and passed to the assistant.
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(40, "Use 40 characters or fewer")
  .regex(/^[\p{L}\p{M} '’.-]+$/u, "Use letters only");

export function parseName(value: string) {
  return nameSchema.safeParse(value);
}

/** The first word of a stored name, or "" when there isn't one. */
export function firstName(displayName: string | null | undefined) {
  return (
    (displayName ?? "")
      .replace(/[^\p{L}\p{M} '’.-]/gu, " ")
      .trim()
      .split(/\s+/)[0]
      ?.slice(0, 40) ?? ""
  );
}

export function parseEmail(value: string) {
  return emailSchema.safeParse(value);
}

export function parseNewPassword(value: string) {
  return newPasswordSchema.safeParse(value);
}

export function parsePassword(value: string) {
  return passwordSchema.safeParse(value);
}

// Maps Supabase auth errors to text safe to show a person.
export function friendlyAuthError(error: { message?: string; code?: string }) {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (text.includes("invalid login") || text.includes("invalid_credentials")) {
    return "Wrong email or password.";
  }
  if (text.includes("already") || text.includes("exists")) {
    return "That email already has an account. Try signing in.";
  }
  if (text.includes("not confirmed")) {
    return "Confirm your email first, using the link we sent you.";
  }
  if (text.includes("weak") || text.includes("pwned") || text.includes("password should")) {
    return "Choose a stronger password.";
  }
  if (text.includes("rate") || text.includes("too many") || text.includes("seconds")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return "Something went wrong. Please try again.";
}
