import { Suspense } from "react";
import { HomeScreen } from "@/components/home-screen";

// The screen reads today's date and time, which have to wait for the browser.
export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeScreen />
    </Suspense>
  );
}
