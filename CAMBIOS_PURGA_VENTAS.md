# Purga definitiva de ventas — StreamLinx

Se agregó/reforzó la operación de borrado definitivo de ventas en el panel oculto de StreamLinx.

## Comportamiento

- No solicita PIN/código de gerente al confirmar el borrado.
- Borrado individual y borrado de todas las ventas desde Invoices/System.
- Elimina la fila de `public.sales` mediante RPC de Supabase cuando hay conexión.
- Elimina la copia de IndexedDB inmediatamente.
- Elimina operaciones antiguas de la outbox que podrían volver a subir la venta.
- Limpia referencias de la venta en `history_records` y `audit_events`.
- Limpia la venta de snapshots/backups, incluyendo historial/eventos y ventas embebidas dentro de cierres de caja.
- Limpia la venta de los cierres de caja locales/remotos donde esté embebida.
- En modo offline guarda solo una orden mínima de purga (IDs/corte), sin guardar nuevamente los datos completos de la venta, para ejecutar el borrado remoto al recuperar conexión.
- Publica un marcador de purga para que otros equipos limpien su IndexedDB y no vuelvan a subir registros antiguos.

## Supabase

`supabase/migrations/0007_harden_sales_purge.sql` refuerza la función `purge_sales_data` para instalaciones que ya tenían aplicada la migración anterior.

Ejecuta las migraciones con:

```powershell
npx supabase db push
```

Después vuelve a desplegar Cloudflare con el proyecto actualizado.

## Nota de seguridad

La interfaz no pide un segundo PIN de gerente. La RPC de Supabase mantiene la autorización de servidor para cuentas administrativas activas; esto evita que un empleado pueda llamar directamente a la operación destructiva aunque conozca la ruta del panel.
