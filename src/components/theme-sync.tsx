"use client";

import { useEffect } from "react";
import { applyTheme, readTheme } from "@/lib/theme";

// While the choice is "auto", follows the phone when it switches between light
// and dark.
export function ThemeSync() {
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (readTheme() === "auto") applyTheme("auto");
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  return null;
}
