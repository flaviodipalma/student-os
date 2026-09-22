// Supabase project settings. Both are safe to expose to the browser (that's what
// the NEXT_PUBLIC_ prefix means): the publishable key only allows what Row Level
// Security permits, and every Student OS table has RLS enabled with no policies.
export function supabaseEnv(): { url: string; publishableKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  return url && publishableKey ? { url, publishableKey } : null
}
