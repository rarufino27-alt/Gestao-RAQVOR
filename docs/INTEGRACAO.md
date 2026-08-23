# RAQVOR — contrato de integração

Os três clientes oficiais usam o **mesmo projeto Supabase** como fonte única de verdade.

- RAQVOR Desktop → leitura/escrita financeira completa
- RAQVOR Mobile → leitura/operação móvel e Assistente
- RAQVOR Admin → suporte, usuários, auditoria e administração
- RAQVOR Backend → Auth, Postgres, Storage, Realtime e Edge Functions

## Projeto Supabase

URL configurada nos clientes:
`https://zowmlsusgnzqskuplxcu.supabase.co`

A chave `sb_publishable_...` é a chave pública do cliente. Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` ou `OPENAI_API_KEY` em nenhum frontend.

## Regras de sincronização

1. Desktop, Mobile e Admin nunca conversam diretamente entre si.
2. Todos consultam o mesmo Supabase.
3. `app_state` é o estado financeiro por workspace.
4. `profiles`, `support_tickets`, `support_messages`, `customer_accounts` e tabelas administrativas ficam no mesmo banco.
5. Realtime é usado para atualizações de suporte e `app_state`.
6. O Mobile não mantém uma base financeira independente; o cache local serve apenas para inicialização/continuidade.

## Edge Functions

- `raqvor-ai` — Assistente financeiro
- `raqvor-support-ai` — IA de triagem do suporte
- `raqvor-admin` — operações administrativas protegidas por service role no servidor
- `raquor-ai` — compatibilidade legada; pode ser mantida durante a transição

## Deploy

Faça o deploy das funções a partir deste repositório com o Supabase CLI. Configure os secrets no projeto Supabase:

- `OPENAI_API_KEY`
- `RAQVOR_AI_MODEL`
- `SUPABASE_SERVICE_ROLE_KEY` (somente na função administrativa)

## Storage

Crie manualmente no Dashboard um bucket público chamado:

`profile-avatars`

O bucket de avatares não é criado automaticamente pela migration porque a criação via SQL pode ser bloqueada pela RLS do Storage.


## V2.14 — mensagens de suporte
Execute a migration `20260823_raqvor_support_message_status.sql` depois das migrations anteriores. Ela adiciona `delivered_at`/`read_at` e RPCs seguros para os estados de mensagem.

Não execute novamente `20260822_raqvor_v2_12_profiles_admin.sql` se você já encontrou o erro de RLS ao criar o bucket. O bucket `profile-avatars` deve ser criado pelo Dashboard do Supabase.

Para IA, configure `OPENAI_API_KEY` e `RAQVOR_AI_MODEL` nas Edge Functions. Para administração, `SUPABASE_SERVICE_ROLE_KEY` fica somente na função `raqvor-admin`.
