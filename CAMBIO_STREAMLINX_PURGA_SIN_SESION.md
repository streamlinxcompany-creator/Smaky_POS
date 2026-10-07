# StreamLinx – purga sin sesión

La purga definitiva de ventas de StreamLinx ya no depende de `smaky-session` ni de una sesión autenticada de Supabase.

- StreamLinx tiene un operador interno independiente.
- El borrado usa `streamlinx_purge_sales_data`.
- El PIN de StreamLinx sigue siendo el único acceso solicitado por la interfaz.
- No se pide PIN de gerente.
- Las purgas realizadas sin internet siguen usando el outbox técnico y se ejecutan remotamente al volver la conexión.
