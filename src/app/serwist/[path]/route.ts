import { randomUUID } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

// The offline page is precached; a new revision per deploy keeps it current. It
// must be the same on every server instance of one deploy: if each instance made
// up its own, the service worker file would differ between requests and every
// open app would be told a new version is ready, again and again.
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
