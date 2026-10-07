# Smaky POS v0.14.1 — reparación de login/pantalla negra

Esta versión conserva la lógica de negocio y corrige el flujo de arranque/login para que un problema de red, Supabase o IndexedDB no deje una pantalla negra sin explicación.

Cambios principales:
- El login contra Supabase tiene timeout de 10 segundos.
- Si falla la red, se busca el perfil completo en IndexedDB para permitir el login local cuando exista un PIN cacheado.
- La lectura del perfil `profiles` también tiene timeout y fallback local ante errores de red.
- El botón de login muestra `Conectando…` mientras autentica y vuelve a mostrar un error legible cuando falla.
- El arranque ya no se queda sin renderizar si `seed()` o la validación inicial de sesión lanzan una excepción.
- Se añadió un Error Boundary para mostrar el error de renderizado en pantalla en lugar de dejar la aplicación completamente negra.

No se incluyen `node_modules`.
