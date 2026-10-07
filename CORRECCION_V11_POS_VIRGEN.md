# V11 — Dejar POS virgen desde StreamLinx

Se añade una única operación global en StreamLinx: **DEJAR POS VIRGEN**.

La operación requiere conexión a Supabase para garantizar que el borrado quede aplicado en la fuente central antes de limpiar el dispositivo que ejecuta la acción.

Elimina físicamente del servidor y de los cachés/outbox de los dispositivos los datos operativos:

- ventas / facturas
- cierres de caja
- pedidos
- clientes
- historial
- auditoría
- backups
- todos los usuarios excepto el Gerente

Se conservan **productos y configuración general** para que el POS pueda volver a utilizarse inmediatamente.

Además se crea un `streamlinx_pos_reset_state` remoto. Cada dispositivo consulta ese estado al sincronizar y descarta cualquier dato/outbox anterior al último reinicio global antes de intentar sincronizarlo. Esto evita que un equipo que tenía datos viejos offline los vuelva a subir después del reinicio.

Migración nueva:

`supabase/migrations/0013_streamlinx_pos_virgin_reset.sql`

El `admin-users` incluye también una barrera para operaciones de usuario encoladas antes del último reinicio global.
