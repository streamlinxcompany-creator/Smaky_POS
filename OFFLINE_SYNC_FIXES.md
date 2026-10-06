# Smaky POS — corrección de persistencia y modo offline

## Arquitectura

Supabase es la fuente de verdad. El navegador usa IndexedDB únicamente como caché durable y como **outbox** para las operaciones pendientes cuando no hay conexión.

Cada escritura de negocio actualiza primero la caché local y, dentro de la misma transacción de IndexedDB, deja una operación pendiente en `syncQueue`. Cuando vuelve la conexión, el sincronizador recupera automáticamente la sesión Supabase, envía primero la outbox y después reconcilia la caché con el servidor.

## Operaciones protegidas

- productos
- clientes
- pedidos
- ventas / facturas
- cierres de caja
- configuraciones
- auditoría e historial
- backups
- altas, cambios y bajas de usuarios
- `Reset de pruebas`
- restauración de registros archivados

## Reset de pruebas

Online: se ejecuta `public.reset_test_data()` en Supabase y después se actualiza la caché local.

Offline: se archivan localmente las ventas, pedidos y cierres visibles y se agrega una sola operación `system/reset` a la outbox. Al reconectar, el reset remoto se ejecuta antes de la reconciliación.

Además, antes de un reset remoto se vacía la outbox disponible para evitar que una operación antigua vuelva a crear datos después del reset.

## Usuarios

Las bajas remotas ahora son **soft-delete** (`profiles.active = false`) para no destruir la identidad de Auth. La restauración vuelve a provisionar/activar la cuenta usando `legacyId`, incluso si una instalación anterior había eliminado físicamente la cuenta.

## Auditoría

Los eventos de auditoría, historial y backups son append-only y ya no se coalescen entre sí en la outbox. Cada evento mantiene su propia operación pendiente.

## Verificación

La sintaxis y el tipado interno de los módulos críticos (`db`, `sync`, `store`, `auth`, `main`, `Layout`, `CashClosing`) fueron revisados con TypeScript. El `npm run build` completo no puede ejecutarse dentro de este entorno porque el ZIP original no contiene las dependencias instaladas en `node_modules`; las dependencias deben instalarse con `npm install`/`npm ci` antes del build.
