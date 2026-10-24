"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createMockClient } from "./mock";

export function MockProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createMockClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
