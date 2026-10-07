# Corrección v7 — historial de ventas

La fila `#EFINED` correspondía a un registro corrupto con identidad literal `undefined` (el fallback de la interfaz mostraba los últimos seis caracteres).

Cambios:
- El historial elimina del caché local ventas incompletas/corruptas antes de mostrarlas.
- El sincronizador remoto no materializa ventas con id/payment/user inválidos.
- `completeOrder` y `addSale` rechazan ventas incompletas antes de escribirlas.
- El historial escucha los eventos de sincronización y se actualiza cuando Supabase confirma el estado remoto.
- Migración `0010_cleanup_malformed_sales.sql` elimina la fila corrupta ya existente en Supabase y evita nuevamente IDs `undefined`/`null`/vacíos o pagos vacíos.

Después de subir esta versión, ejecutar `npx supabase db push` una vez para aplicar la limpieza remota.
