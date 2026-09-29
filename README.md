# Smaky POS

POS web/PWA para Smaky Burgers. Base administrativa con dashboard, punto de venta, catálogo de productos, ventas, reportes y usuarios.

## Arquitectura actual
- Frontend: React + TypeScript + Vite.
- PWA: vite-plugin-pwa para instalar en PC/celular y tener shell offline.
- Offline-first: IndexedDB mediante Dexie. Las ventas y los productos se guardan localmente.
- Backend: Supabase (Postgres + Auth + Realtime) queda preparado para una siguiente fase de autenticación, multiusuario y sincronización.
- Hosting: Cloudflare Pages para el frontend estático.

## Datos locales
La app crea el catálogo inicial de productos cuando la base local está vacía. Las ventas de demostración no se cargan. Además, al iniciar se eliminan registros históricos identificados como `demo-*` para limpiar instalaciones de desarrollo existentes.

## Ejecutar
1. Instalar Node.js 22+.
2. `npm install`
3. `npm run dev`
4. Abrir la URL local que muestra Vite.

## Principio clave
El POS no debe depender de internet para cobrar. La venta entra primero a IndexedDB y queda disponible localmente; la sincronización con un backend se incorporará en la siguiente fase.


## v0.4
- Cobro protegido con confirmación y deslizar para confirmar.
- Las ventas se guardan solo al completar la confirmación.
- Historial de ventas clicable con comprobante detallado.

## v0.6
- Aviso verde de venta guardada reposicionado como toast fijo en la esquina inferior derecha.
- El aviso queda por encima del contenido y ya no puede quedar oculto detrás del menú lateral.
- En pantallas pequeñas conserva márgenes seguros para mantenerse completamente visible.


### v0.6
- Aviso de venta guardada con animación suave de entrada y salida.
