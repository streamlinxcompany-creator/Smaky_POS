# Smaky POS / StreamLinx v6.4 — purga y consistencia de ventas

## Qué cambió
- Una purga hecha con internet debe ejecutarse primero en Supabase.
- El navegador solo borra localmente después de que Supabase responde y confirma `remainingSales = 0`.
- Si el navegador está realmente offline, la purga local se acompaña de una operación durable `purge_sales` para ejecutar el borrado remoto al recuperar conexión.
- El sincronizador trata `sales` como entidad de origen remoto: si una venta existe en IndexedDB pero ya no existe en Supabase, la venta local se elimina y no se vuelve a subir.
- Antes de vaciar una outbox en otro dispositivo se lee el marcador de purga remoto para evitar resurrección de facturas antiguas.
- No se solicita PIN de gerente. La autorización del panel oculto sigue siendo el acceso StreamLinx.

## Migración
Agregar y aplicar:
- `supabase/migrations/0009_streamlinx_purge_verify.sql`

El 0009 reemplaza la misma función RPC creada en 0008 y añade la verificación `remainingSales`.

## Resultado esperado
Con internet disponible, borrar la factura #123 en StreamLinx significa:
1. Supabase elimina la fila de `sales`.
2. Supabase limpia las referencias relacionadas configuradas para la purga.
3. Supabase confirma que no quedan ventas que coincidan con la purga.
4. El navegador elimina su copia local.
5. Los demás dispositivos, al sincronizar, eliminan su copia local porque la factura ya no existe en Supabase.

No se debe considerar "eliminada definitivamente" una purga que solo haya ocurrido en IndexedDB mientras el navegador dice estar online.
