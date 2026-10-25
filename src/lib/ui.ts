// Shared Tailwind class strings built on the tokens in globals.css.
// Inputs are text-base (16px) so iPhone Safari does not zoom when one is
// focused, and every touch target is at least 44px.
// Shapes follow the Midnight direction: pills for anything you tap or type
// into, large soft corners for surfaces, and no outlines (tone does the work).

export const inputClass =
  "w-full min-h-12 rounded-full border border-transparent bg-surface-2 px-4 text-base text-ink placeholder:text-ink-3 outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/20";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "lg" | "sm";

const BUTTON_BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-gold text-on-gold hover:bg-gold-strong",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3",
  ghost: "text-ink-2 hover:bg-surface-2",
  danger: "bg-expense-soft text-expense hover:brightness-95",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-10 px-4 text-sm",
  md: "min-h-11 px-5 text-[0.9375rem]",
  lg: "min-h-12 px-6 text-base",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  full = false,
) {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${full ? "w-full" : ""}`;
}

// Kept for screens that have not moved to <Button> yet.
export const primaryButtonClass = buttonClass("primary", "md", true);
export const secondaryButtonClass = buttonClass("secondary", "md");

export const cardClass = "rounded-[1.75rem] bg-surface p-4 shadow-card";

export const mutedClass = "text-ink-2";
