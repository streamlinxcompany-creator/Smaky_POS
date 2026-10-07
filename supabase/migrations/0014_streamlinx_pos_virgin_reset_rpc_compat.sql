-- StreamLinx POS Virgin reset RPC compatibility.
-- 0013 creates the canonical implementation with the legacy argument order:
--   (p_reset_at timestamptz, p_access_key text)
-- The application calls the function with named arguments in the order used by
-- the client, so PostgreSQL/PostgREST needs an overload with the input types:
--   (p_access_key text, p_reset_at timestamptz)
--
-- IMPORTANT: do NOT drop or replace the 0013 function here. PostgreSQL identifies
-- functions by name + input types, and removing the old function before creating
-- the wrapper would make the wrapper reference a function that no longer exists.

create function public.streamlinx_reset_pos_to_virgin(
  p_access_key text,
  p_reset_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.streamlinx_reset_pos_to_virgin(
    p_reset_at,
    p_access_key
  );
$$;

revoke execute on function public.streamlinx_reset_pos_to_virgin(text, timestamptz) from public;
grant execute on function public.streamlinx_reset_pos_to_virgin(text, timestamptz) to anon, authenticated;

grant execute on function public.streamlinx_reset_pos_to_virgin(timestamptz, text) to anon, authenticated;

notify pgrst, 'reload schema';
