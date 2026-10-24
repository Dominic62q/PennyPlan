"use client";

import { useState } from "react";
import { NameSheet } from "@/components/name-sheet";
import { useDisplayName } from "@/lib/profile";

function timeOfDay(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// "Good evening, Kwame". Without a name it offers to add one, quietly.
export function Greeting({ className = "" }: { className?: string }) {
  const { ready, displayName, name } = useDisplayName();
  const [asking, setAsking] = useState(false);
  return (
    <p className={className}>
      {name ? `${timeOfDay()}, ${name}` : timeOfDay()}
      {ready && !name && (
        <>
          {" · "}
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="font-semibold underline decoration-ink-3/60 underline-offset-2"
          >
            Add your name
          </button>
          <NameSheet open={asking} onClose={() => setAsking(false)} current={displayName} />
        </>
      )}
    </p>
  );
}
