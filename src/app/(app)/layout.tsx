import { AssistantFab } from "@/components/assistant-fab";
import { BottomNav } from "@/components/bottom-nav";
import { LaunchOverlay } from "@/components/launch-overlay";
import { RecurringSync } from "@/components/recurring-sync";
import { Tour } from "@/components/tour";

// Main screens share the bottom bar and the launch splash. Quick add sits
// outside this group so the keypad gets the whole screen.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        {children}
      </main>
      <AssistantFab />
      <BottomNav />
      <LaunchOverlay />
      <RecurringSync />
      <Tour />
    </>
  );
}
