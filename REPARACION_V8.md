# Smaky POS — reparación V8

Correcciones respecto a V7:

1. Se restauró `src/App.tsx` al App original del proyecto. No se usa el ErrorBoundary experimental que provocaba errores con los tipos React del proyecto.
2. Se restauró `src/react-shims.d.ts` al original.
3. En `src/lib/auth.ts` se corrigió el tipado del resultado de `signInWithPassword` para no asignar `null` al tipo `data` de Supabase.
4. Se conservan los timeouts y la recuperación local introducidos en V6/V7 para evitar que el login quede colgado indefinidamente.
5. No se incluye `node_modules`.

Objetivo: que `npm run build` compile en Cloudflare sin cambiar la lógica del POS.
