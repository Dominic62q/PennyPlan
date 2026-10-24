import { Suspense } from "react";
import { AssistantScreen } from "@/components/assistant/assistant-screen";

export const metadata = { title: "Penny" };

// Outside the (app) group, like quick add: the chat takes the whole screen.
export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantScreen />
    </Suspense>
  );
}
