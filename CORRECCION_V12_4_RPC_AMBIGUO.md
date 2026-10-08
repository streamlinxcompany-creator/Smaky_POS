# Corrección v12.4 — RPC de POS Virgen ambiguo

Se elimina el overload `streamlinx_reset_pos_to_virgin(text, timestamptz)` creado por la migración 0014.

La función canónica original de `0013` (`timestamptz, text`) sigue siendo la única función con ese nombre. La app continúa invocándola mediante argumentos nombrados:

- `p_access_key`
- `p_reset_at`

Esto evita el error de PostgREST `Could not choose the best candidate function between...`.

Nueva migración:

`supabase/migrations/0015_streamlinx_reset_remove_ambiguous_overload.sql`
