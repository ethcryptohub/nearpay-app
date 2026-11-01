import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

export function getSupabaseOperationError(
  operation: string,
  error: { code?: string; message: string },
): Error {
  if (error.code === "42501") {
    return new Error(
      `${operation}: Supabase denied access to a required table. Apply lib/supabase-permissions-fix.sql in the Supabase SQL Editor, and verify that Vercel's SUPABASE_SERVICE_ROLE_KEY contains the server-side service_role/secret key.`,
    );
  }
  return new Error(`${operation}: ${error.message}`);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) {
    return adminClient;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the project-root .env.local file, then restart Next.js.",
    );
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return adminClient;
}
