-- Resolve the StreamLinx POS Virgin RPC ambiguity.
-- Migration 0014 introduced a second overload with the same argument names
-- (text, timestamptz), just in the opposite positional order. PostgreSQL/
-- PostgREST cannot choose between those overloads when the RPC is called with
-- named arguments, because named arguments identify parameters by name, not
-- by declaration order.
--
-- Keep the original 0013 function signature and remove only the compatibility
-- overload created by 0014. The application already sends named arguments
-- (p_access_key, p_reset_at), which remain valid against the single remaining
-- function.

drop function if exists public.streamlinx_reset_pos_to_virgin(text, timestamptz);

notify pgrst, 'reload schema';
