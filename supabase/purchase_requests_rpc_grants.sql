-- Ограничить вызов payment RPC только service_role (webhook через SUPABASE_SERVICE_ROLE_KEY).
REVOKE ALL ON FUNCTION public.acquire_processing_lock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_processing_lock(uuid) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.fulfill_purchase_full(
  uuid, bigint, bigint, text, numeric, integer, text, timestamptz, bigint, text, bigint, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_purchase_full(
  uuid, bigint, bigint, text, numeric, integer, text, timestamptz, bigint, text, bigint, bigint, text
) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.release_processing_lock(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_processing_lock(uuid, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_processing_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfill_purchase_full(
  uuid, bigint, bigint, text, numeric, integer, text, timestamptz, bigint, text, bigint, bigint, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_processing_lock(uuid, text) TO service_role;
