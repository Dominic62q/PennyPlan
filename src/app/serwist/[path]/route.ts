import { randomUUID } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

// The offline page is precached; a fresh revision per build keeps it current.
const revision = randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
