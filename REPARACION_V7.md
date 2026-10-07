# Smaky POS — Reparación V7

Esta versión corrige los errores de compilación introducidos en V6 y conserva los cambios de protección del login.

## Correcciones de V7

1. `src/react-shims.d.ts`
   - Se añadieron las declaraciones de `Component`, `ErrorInfo`, `props`, `state`, `setState` y `forceUpdate` necesarias para el Error Boundary.

2. `src/lib/auth.ts`
   - `data` y `error` del login Supabase ahora se inicializan explícitamente para evitar `TS2454: Variable 'data' is used before being assigned`.

## Se conserva de V6

- Timeout de 10 segundos para la autenticación Supabase.
- Timeout de 10 segundos para la consulta de `profiles`.
- Fallback local cuando el problema es de red y existe un usuario completo en IndexedDB.
- Pantalla de recuperación ante errores de renderizado para evitar una pantalla negra sin explicación.

## Importante

El ZIP no contiene `node_modules`. Cloudflare Pages debe ejecutar la instalación de dependencias durante el build.
