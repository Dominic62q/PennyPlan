import { Suspense } from "react";
import { AccountsScreen } from "@/components/accounts-screen";

export const metadata = { title: "Accounts" };

export default function AccountsPage() {
  return (
    <Suspense fallback={null}>
      <AccountsScreen />
    </Suspense>
  );
}
