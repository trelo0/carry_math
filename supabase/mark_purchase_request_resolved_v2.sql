-- Атомарное завершение заявки (pending или processing → approved/rejected).
CREATE OR REPLACE FUNCTION mark_purchase_request_resolved(
  p_id uuid,
  p_status text,
  p_resolved_by bigint DEFAULT NULL
) RETURNS boolean AS $$
DECLARE
  v_updated uuid;
BEGIN
  UPDATE public.purchase_requests
  SET
    status = p_status,
    resolved_at = now(),
    resolved_by = p_resolved_by,
    processing_updated_at = NULL
  WHERE id = p_id
    AND status IN ('pending', 'processing')
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.mark_purchase_request_resolved(uuid, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_purchase_request_resolved(uuid, text, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_purchase_request_resolved(uuid, text, bigint) TO service_role;
