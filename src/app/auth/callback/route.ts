import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/server/auth"

// Where the "confirm your email" link lands (only used when email confirmation is
// turned on in Supabase). Exchanges the one-time code for a session, then opens the app.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL("/dashboard", request.url))
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", request.url))
}
