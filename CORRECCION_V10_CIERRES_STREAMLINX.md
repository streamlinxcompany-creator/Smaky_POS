# Corrección v10 — cierres de caja en StreamLinx

- Cash en StreamLinx ahora permite borrar un cierre individual o todos los cierres.
- No pide PIN de gerente; usa la sesión independiente de StreamLinx.
- Supabase es la fuente de verdad para `cash_closures`.
- La RPC `streamlinx_purge_cash_closures` borra físicamente la fila remota y limpia historial/auditoría/backups.
- Tombstones impiden que un outbox offline recree un cierre ya purgado.
- Si se elimina el cierre de hoy, el POS vuelve a la fecha de hoy y vuelve a solicitar el cierre.
- Los borrados offline quedan en una operación `purge_cash_closures` que se envía al volver la conexión.
