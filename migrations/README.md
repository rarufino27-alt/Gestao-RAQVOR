# RAQVOR V2.10 — Supabase

Execute `20260822_raqvor_commercial_support.sql` **after** the existing V1.15 authentication/security migrations.

After creating the first owner account, add that Auth user to `public.admin_users` using the bootstrap statement at the bottom of the SQL file.

Never place a Supabase secret/service-role key or an OpenAI API key in the browser/mobile APK. Elevated operations belong in Edge Functions. Supabase publishable keys are intended for client apps with RLS enabled; secret keys bypass RLS and must remain server-side.
