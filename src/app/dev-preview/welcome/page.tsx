"use client";

import { useState } from "react";
import { WelcomeScene } from "@/components/welcome-scene";

// The after-sign-in scene on its own, with a replay button. Dev only (the layout
// above 404s in production).
export default function WelcomePreview() {
  const [run, setRun] = useState(0);
  const [still, setStill] = useState(false);
  return (
    <div className="fixed inset-0">
      <div
        key={`${run}-${still}`}
        className="h-full"
        style={still ? undefined : { animation: "scene-reveal 0.65s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
      >
        <WelcomeScene title="Welcome back" subtitle="Good to see you again." still={still} />
      </div>
      <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            setStill(false);
            setRun((n) => n + 1);
          }}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#10241d]"
        >
          Replay
        </button>
        <button
          type="button"
          onClick={() => setStill(true)}
          className="rounded-full border border-white/40 px-5 py-2 text-sm font-semibold text-white"
        >
          Resting state
        </button>
      </div>
    </div>
  );
}
