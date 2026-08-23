-- RAQVOR V2.13 — permissões operacionais, perfil e suporte
-- IMPORTANTE: não cria storage bucket. Crie `profile-avatars` no Dashboard > Storage.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Perfil: usuário próprio + administrador ativo.
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_active_admin());

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.is_active_admin())
WITH CHECK (id = auth.uid() OR public.is_active_admin());

-- Avatar: cada usuário grava apenas na própria pasta.
DROP POLICY IF EXISTS profile_avatars_select_self ON storage.objects;
CREATE POLICY profile_avatars_select_self ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

DROP POLICY IF EXISTS profile_avatars_insert_self ON storage.objects;
CREATE POLICY profile_avatars_insert_self ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

DROP POLICY IF EXISTS profile_avatars_update_self ON storage.objects;
CREATE POLICY profile_avatars_update_self ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text)
WITH CHECK (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

DROP POLICY IF EXISTS profile_avatars_delete_self ON storage.objects;
CREATE POLICY profile_avatars_delete_self ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

-- Admin pode consultar/alterar cadastro comercial.
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_accounts_self_select ON public.customer_accounts;
CREATE POLICY customer_accounts_self_select ON public.customer_accounts
FOR SELECT TO authenticated
USING (user_id=auth.uid() OR public.is_active_admin());
DROP POLICY IF EXISTS customer_accounts_admin_write ON public.customer_accounts;
CREATE POLICY customer_accounts_admin_write ON public.customer_accounts
FOR ALL TO authenticated
USING (public.is_active_admin())
WITH CHECK (public.is_active_admin());

-- Admin com sessão ativa consegue trabalhar no workspace do cliente.
DROP POLICY IF EXISTS finance_workspaces_admin_support_select ON public.finance_workspaces;
CREATE POLICY finance_workspaces_admin_support_select ON public.finance_workspaces
FOR SELECT TO authenticated
USING (owner_user_id=auth.uid() OR public.is_active_admin());

DROP POLICY IF EXISTS app_state_admin_support_select ON public.app_state;
CREATE POLICY app_state_admin_support_select ON public.app_state
FOR SELECT TO authenticated
USING (
  workspace_id IN (SELECT id FROM public.finance_workspaces WHERE owner_user_id=auth.uid())
  OR public.is_active_admin()
);

DROP POLICY IF EXISTS app_state_admin_support_update ON public.app_state;
CREATE POLICY app_state_admin_support_update ON public.app_state
FOR UPDATE TO authenticated
USING (
  workspace_id IN (SELECT id FROM public.finance_workspaces WHERE owner_user_id=auth.uid())
  OR public.is_active_admin()
)
WITH CHECK (
  workspace_id IN (SELECT id FROM public.finance_workspaces WHERE owner_user_id=auth.uid())
  OR public.is_active_admin()
);

DROP POLICY IF EXISTS app_state_admin_support_insert ON public.app_state;
CREATE POLICY app_state_admin_support_insert ON public.app_state
FOR INSERT TO authenticated
WITH CHECK (
  workspace_id IN (SELECT id FROM public.finance_workspaces WHERE owner_user_id=auth.uid())
  OR public.is_active_admin()
);

-- Realtime para perfil e suporte.
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;
