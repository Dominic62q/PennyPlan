import {
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Clapperboard,
  Coffee,
  CreditCard,
  Droplets,
  Ellipsis,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Music,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Store,
  Tag,
  Tv,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AccountType, CategoryKind } from "./types";

// Icons a person can choose for a category. The database stores only the key,
// so the list can grow without a migration.
export const CATEGORY_ICONS = {
  utensils: Utensils,
  coffee: Coffee,
  basket: ShoppingBasket,
  bus: Bus,
  car: Car,
  fuel: Fuel,
  plane: Plane,
  receipt: Receipt,
  zap: Zap,
  droplets: Droplets,
  wifi: Wifi,
  phone: Smartphone,
  tv: Tv,
  house: House,
  wrench: Wrench,
  heart: HeartPulse,
  pill: Pill,
  graduation: GraduationCap,
  book: BookOpen,
  bag: ShoppingBag,
  shirt: Shirt,
  film: Clapperboard,
  game: Gamepad2,
  music: Music,
  gift: Gift,
  baby: Baby,
  family: Users,
  sparkles: Sparkles,
  scissors: Scissors,
  bank: Landmark,
  cash: Banknote,
  briefcase: Briefcase,
  store: Store,
  trending: TrendingUp,
  wallet: Wallet,
  piggy: PiggyBank,
  coins: HandCoins,
  more: Ellipsis,
  tag: Tag,
} satisfies Record<string, LucideIcon>;

export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

export function categoryIcon(key: string | null | undefined): LucideIcon {
  return (key && key in CATEGORY_ICONS
    ? CATEGORY_ICONS[key as CategoryIconKey]
    : Tag) as LucideIcon;
}

// Ten hues that stay readable behind a white icon in light and dark mode.
export const CATEGORY_COLORS = [
  "#e8590c",
  "#1c7ed6",
  "#7048e8",
  "#0ca678",
  "#e03131",
  "#3b5bdb",
  "#d6336c",
  "#f08c00",
  "#0c8599",
  "#868e96",
] as const;

// A category with no colour of its own gets a steady one from its id, so it
// never changes between visits.
export function categoryColor(color: string | null | undefined, id: string) {
  if (color) return color;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

export const ACCOUNT_ICONS: Record<AccountType, LucideIcon> = {
  cash: Banknote,
  bank: Landmark,
  savings: PiggyBank,
  credit_card: CreditCard,
  mobile_money: Smartphone,
  investment: TrendingUp,
  loan: HandCoins,
};

export const ACCOUNT_COLORS: Record<AccountType, string> = {
  cash: "#0ca678",
  bank: "#1c7ed6",
  savings: "#f08c00",
  credit_card: "#7048e8",
  mobile_money: "#e8590c",
  investment: "#0c8599",
  loan: "#d6336c",
};

// Offered once, on an empty Categories screen. Nothing is added unless the
// person picks it.
export type SuggestedCategory = {
  name: string;
  kind: CategoryKind;
  icon: CategoryIconKey;
  color: string;
};

export const SUGGESTED_CATEGORIES: SuggestedCategory[] = [
  { name: "Food & Dining", kind: "expense", icon: "utensils", color: "#e8590c" },
  { name: "Groceries", kind: "expense", icon: "basket", color: "#0ca678" },
  { name: "Transport", kind: "expense", icon: "bus", color: "#1c7ed6" },
  { name: "Fuel", kind: "expense", icon: "fuel", color: "#868e96" },
  { name: "Bills & Utilities", kind: "expense", icon: "receipt", color: "#7048e8" },
  { name: "Airtime & Data", kind: "expense", icon: "phone", color: "#0c8599" },
  { name: "Rent", kind: "expense", icon: "house", color: "#3b5bdb" },
  { name: "Health", kind: "expense", icon: "heart", color: "#e03131" },
  { name: "Education", kind: "expense", icon: "graduation", color: "#3b5bdb" },
  { name: "Shopping", kind: "expense", icon: "bag", color: "#d6336c" },
  { name: "Entertainment", kind: "expense", icon: "film", color: "#f08c00" },
  { name: "Family & Gifts", kind: "expense", icon: "gift", color: "#d6336c" },
  { name: "Personal care", kind: "expense", icon: "sparkles", color: "#7048e8" },
  { name: "Fees & Charges", kind: "expense", icon: "bank", color: "#495057" },
  { name: "Other", kind: "expense", icon: "more", color: "#868e96" },
  { name: "Salary", kind: "income", icon: "briefcase", color: "#0ca678" },
  { name: "Business income", kind: "income", icon: "store", color: "#0c8599" },
  { name: "Gifts received", kind: "income", icon: "gift", color: "#d6336c" },
  { name: "Interest & investments", kind: "income", icon: "trending", color: "#3b5bdb" },
  { name: "Other income", kind: "income", icon: "more", color: "#868e96" },
];
