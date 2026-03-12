import { createClient } from "@supabase/supabase-js";

// ─── Supabase Admin Client ────────────────────────────────────────────────────
// Uses the service role key — full DB access, no RLS restrictions.
// Never expose this to the browser — server-side only.

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
