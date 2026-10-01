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


## v0.14 — Cierre diario administrativo

- Nueva sección `Cierre de caja` para Administrador y Gerente.
- Cierre por día con resumen de ventas, efectivo esperado, efectivo contado y diferencia.
- Confirmación mediante slider de arrastre real.
- Al cerrar un día, el siguiente periodo se calcula automáticamente para el día siguiente.
- Historial administrativo de cierres con consulta de las facturas conservadas en cada cierre.
- Panel de Inicio administrativo con estado del cierre y últimos cierres.
- Se bloquean nuevos pedidos/ventas después de cerrar el día actual.

### StreamLinx Private Core

Hay un módulo aislado y cargado bajo demanda desde `src/streamlinx/`. Desde la pantalla de inicio de sesión, `Ctrl + Alt + M` abre la secuencia privada de StreamLinx. La firma de acceso se configura con `VITE_STREAMLINX_KEY` en `.env.local`.

El panel muestra analíticas reales de la base local de Smaky y un vault visual para futuros secretos. Las credenciales reales no se guardan en el frontend: para seguridad de producción, la autorización y el almacenamiento de secretos deben pasar a un backend/servicio seguro.
