# v12.3 – Corrección RPC POS Virgen

La migración `0014_streamlinx_pos_virgin_reset_rpc_compat.sql` ya no elimina la función creada en `0013` antes de crear el overload compatible.

La aplicación usa la firma:

- `streamlinx_reset_pos_to_virgin(p_access_key text, p_reset_at timestamptz)`

La implementación original de `0013` permanece como:

- `streamlinx_reset_pos_to_virgin(p_reset_at timestamptz, p_access_key text)`

La migración crea solo el overload compatible y lo delega a la implementación existente.
