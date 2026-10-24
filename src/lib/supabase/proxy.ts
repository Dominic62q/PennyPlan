import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "./env";

const PUBLIC_PATHS = ["/login"];

function redirectTo(request: NextRequest, pathname: string, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  // Keep any session cookies that were just refreshed.
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

// Refreshes the auth session cookies on every matched request and sends
// signed-out visitors to /login.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getSupabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Validates the JWT and triggers a refresh if needed. Do not remove.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const isPublic = PUBLIC_PATHS.includes(request.nextUrl.pathname);

  if (!signedIn && !isPublic) {
    // A background request wants a status it can read, not a login page.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in to talk to Penny." }, { status: 401 });
    }
    return redirectTo(request, "/login", response);
  }
  if (signedIn && request.nextUrl.pathname === "/login") {
    return redirectTo(request, "/", response);
  }

  return response;
}
