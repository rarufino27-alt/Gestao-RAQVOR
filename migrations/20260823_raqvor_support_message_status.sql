-- RAQVOR V2.14 — status de entrega/leitura das mensagens de suporte
-- Não cria buckets. Execute no SQL Editor do Supabase.

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_support_messages_delivery
  ON public.support_messages(ticket_id, delivered_at, read_at, created_at);

-- Atualização segura por RPC: evita liberar UPDATE amplo da mensagem ao cliente.
CREATE OR REPLACE FUNCTION public.mark_support_message_delivered(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  UPDATE public.support_messages m
  SET delivered_at = COALESCE(m.delivered_at, now())
  WHERE m.id = p_message_id
    AND (
      public.is_active_admin()
      OR EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id = m.ticket_id AND t.user_id = auth.uid()
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_support_message_read(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  UPDATE public.support_messages m
  SET delivered_at = COALESCE(m.delivered_at, now()),
      read_at = COALESCE(m.read_at, now())
  WHERE m.id = p_message_id
    AND (
      public.is_active_admin()
      OR EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id = m.ticket_id AND t.user_id = auth.uid()
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_support_ticket_read(p_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF NOT (
    public.is_active_admin()
    OR EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = p_ticket_id AND t.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para este atendimento';
  END IF;

  UPDATE public.support_messages m
  SET delivered_at = COALESCE(m.delivered_at, now()),
      read_at = COALESCE(m.read_at, now())
  WHERE m.ticket_id = p_ticket_id
    AND m.sender_user_id <> auth.uid()
    AND m.read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_support_message_delivered(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_support_message_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_support_ticket_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_support_message_delivered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_support_message_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_support_ticket_read(uuid) TO authenticated;

-- Realtime também deve transmitir UPDATEs dos status.
ALTER TABLE public.support_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
      AND schemaname='public'
      AND tablename='support_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
  END IF;
END $$;
