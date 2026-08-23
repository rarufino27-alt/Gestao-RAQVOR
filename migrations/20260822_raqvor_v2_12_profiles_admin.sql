-- RAQVOR V2.12 — perfil, foto e cadastro administrativo de usuários
alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id,name,public) values ('profile-avatars','profile-avatars',true) on conflict (id) do update set public=true;

drop policy if exists profile_avatars_insert_self on storage.objects;
create policy profile_avatars_insert_self on storage.objects for insert to authenticated with check (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists profile_avatars_update_self on storage.objects;
create policy profile_avatars_update_self on storage.objects for update to authenticated using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists profile_avatars_delete_self on storage.objects;
create policy profile_avatars_delete_self on storage.objects for delete to authenticated using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

-- Perfis podem ser editados pelo próprio usuário e pelo suporte/admin ativo.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using (id=auth.uid() or public.is_active_admin()) with check (id=auth.uid() or public.is_active_admin());

-- Realtime de app_state já existente; perfis não precisam de Realtime para esta etapa.
