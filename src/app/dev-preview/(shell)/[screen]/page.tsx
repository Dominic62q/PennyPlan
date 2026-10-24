import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AccountsScreen } from "@/components/accounts-screen";
import { AssistantScreen } from "@/components/assistant/assistant-screen";
import { BillsScreen } from "@/components/bills-screen";
import { BudgetsScreen } from "@/components/budgets-screen";
import { CategoriesScreen } from "@/components/categories-screen";
import { HomeScreen } from "@/components/home-screen";
import { ReportsScreen } from "@/components/reports-screen";
import { TransactionsScreen } from "@/components/transactions-screen";

const SCREENS = {
  home: HomeScreen,
  activity: TransactionsScreen,
  accounts: AccountsScreen,
  categories: CategoriesScreen,
  budgets: BudgetsScreen,
  reports: ReportsScreen,
  bills: BillsScreen,
  assistant: AssistantScreen,
} as const;

export function generateStaticParams() {
  return Object.keys(SCREENS).map((screen) => ({ screen }));
}

async function Resolved({ params }: Pick<PageProps<"/dev-preview/[screen]">, "params">) {
  const { screen } = await params;
  if (!(screen in SCREENS)) notFound();
  const Screen = SCREENS[screen as keyof typeof SCREENS];
  return <Screen />;
}

export default function PreviewScreen({ params }: PageProps<"/dev-preview/[screen]">) {
  return (
    <Suspense fallback={null}>
      <Resolved params={params} />
    </Suspense>
  );
}
