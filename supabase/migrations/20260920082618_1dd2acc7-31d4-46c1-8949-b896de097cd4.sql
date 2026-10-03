REVOKE EXECUTE ON FUNCTION public.tenant_overdue_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.market_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_overdue_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.market_stats() TO authenticated;