# Reparación V10 — pantalla negra de arranque

Se encontró la causa principal del síntoma: `src/main.tsx` esperaba a que terminaran la inicialización de IndexedDB (`seed`) y la validación remota de sesión de Supabase antes de crear el root de React. Si una de esas operaciones se quedaba esperando, `#root` permanecía vacío y la página publicada se veía completamente negra.

Cambios de V10:
- React se monta inmediatamente; la inicialización pasa a segundo plano.
- `seed()` tiene un límite de 8 segundos para no bloquear la interfaz.
- `validateRemoteSession()` tiene además un límite de 8 segundos en el arranque.
- Login escucha `smaky-data-ready` y vuelve a cargar los perfiles cuando IndexedDB termina.
- No se modifican tablas, permisos, ventas, productos ni lógica del POS.
- No se incluye `node_modules`.
