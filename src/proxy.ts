import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { supabaseEnv } from "@/lib/supabase/env"

// Runs before every page request. It does two things:
//   1. keeps the Supabase session fresh (refreshes the token and updates cookies)
//   2. sends signed-out visitors to /login, and signed-in ones away from /login
// This is only a first, fast check. Every data load and server action verifies
// the user again on the server (src/server/auth.ts).

const PUBLIC_PATHS = ["/login", "/signup", "/auth"]

export async function proxy(request: NextRequest) {
  // Health checks answer on their own (no session, no Supabase call).
  if (request.nextUrl.pathname.startsWith("/api/health")) return NextResponse.next()
  const env = supabaseEnv()
  if (!env) return NextResponse.next({ request })

  let response = NextResponse.next({ request })
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value)
      },
    },
  })

  // Don't put code between creating the client and this call: it verifies and refreshes the session.
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
  const isApi = path.startsWith("/api/")

  if (!signedIn && !isPublic && !isApi) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`
    return redirectWithCookies(url, response)
  }
  if (signedIn && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    url.search = ""
    return redirectWithCookies(url, response)
  }
  return response
}

// A redirect that keeps any refreshed session cookies.
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url)
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie)
  return redirect
}

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
