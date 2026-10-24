import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // The mock-data preview pages skip sign-in, but only outside production.
  if (
    process.env.NODE_ENV !== "production" &&
    request.nextUrl.pathname.startsWith("/dev-preview")
  ) {
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets, the service worker, the manifest and the offline page.
    "/((?!_next/static|_next/image|favicon.ico|serwist|manifest.webmanifest|~offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
