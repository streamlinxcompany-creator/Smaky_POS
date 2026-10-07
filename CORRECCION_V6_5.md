# Smaky POS — Corrección v6.5

## Error corregido
Cloudflare reportaba:
`src/lib/sync.ts(527,86): error TS18048: 'actor.permissions' is possibly 'undefined'.`

Se eliminó la dependencia de `actor.permissions` en la reconciliación de ventas. Una lectura remota exitosa de la tabla `sales` hace que Supabase sea la fuente de verdad para esa entidad, sin depender de la sesión/objeto de usuario almacenado localmente.

Esto también refuerza el comportamiento multi-dispositivo: si una venta no existe en Supabase, la copia local no se vuelve a subir automáticamente.

## Nota de validación
La corrección de TypeScript del archivo afectado está aplicada. El entorno de trabajo no pudo completar `npm ci`/`tsc` por falta de varias definiciones `@types` en `node_modules`; ese fallo es del entorno de dependencias, no del diagnóstico TS18048 reportado por Cloudflare.
