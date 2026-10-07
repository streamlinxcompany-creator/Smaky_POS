# Corrección v8 — purga definitiva de ventas

Esta versión corrige dos causas independientes que estaban provocando problemas con el historial de ventas:

1. **Resurrección desde la outbox:** una venta eliminada de Supabase podía existir todavía como operación `sales/upsert` en un navegador antiguo. Al reconectar, esa operación volvía a insertar la venta.
2. **Venta `undefined`:** Supabase devuelve un arreglo cuando se usa `.select('*')` en el upsert de ventas. El cliente estaba tratando ese arreglo como si fuera una fila y podía terminar guardando una venta local con `id="undefined"`.

## Supabase

Se agrega `supabase/migrations/0011_sales_purge_tombstones.sql`.

La migración:

- crea un estado permanente de purga global;
- crea tombstones permanentes por ID de venta purgada;
- impide por trigger que una venta purgada vuelva a insertarse;
- elimina cualquier resurrección que exista en `sales` al momento de aplicar la migración;
- vuelve a reforzar la RPC de StreamLinx para registrar el bloqueo antes de borrar;
- limpia historia, auditoría, backups y cierres vinculados.

## Cliente

- las ventas siguen siendo reconciliadas contra Supabase como fuente de verdad;
- una venta bloqueada por el guard remoto limpia su copia local y su outbox en lugar de reintentarse;
- las ventas se normalizan correctamente después de un upsert remoto para evitar `id="undefined"`;
- antes de vaciar la outbox, un dispositivo conectado hace una reconciliación de ventas.

## Aplicación

Después de reemplazar el proyecto:

```cmd
npx supabase db push
```

Luego despliega a Cloudflare y fuerza una recarga (`Ctrl + Shift + R`).
