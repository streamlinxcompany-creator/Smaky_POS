# Smaky POS — configuración final de Supabase

Esta versión integra Supabase sin eliminar Dexie.

## Lo que ya quedó hecho en el código

- Cliente único de Supabase usando `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Supabase Auth para las cuentas remotas.
- PIN de 4 dígitos convertido internamente en una contraseña de Auth (`SmakyPOS#XXXX`). El PIN no se guarda en tablas públicas de Supabase.
- Dexie conservado como almacenamiento local/offline.
- Sincronización automática de productos, clientes, pedidos, ventas, cierres, configuración, auditoría e historial.
- Migración automática de usuarios antiguos de Dexie cuando el gerente inicia sesión online por primera vez.
- RLS para las tablas remotas.
- Administración de usuarios mediante Edge Function para no exponer `service_role` al navegador.
- `.env.local` excluido de GitHub y `.env.example` incluido como plantilla.

## ÚNICAS acciones manuales

### 1. Crear el gerente inicial en Supabase Auth

Haz esto **antes de ejecutar el SQL**.

Supabase Dashboard → Authentication → Users → Add user.

Usa exactamente:

- Email: `u-owner@smaky.local`
- Password: `SmakyPOS#1234`
- Confirmar/Auto Confirm: activado

Ese usuario será el gerente principal del Smaky POS.

> El PIN que utilizarás dentro del POS seguirá siendo `1234`. La contraseña anterior es solamente el formato interno que usa Supabase Auth.

### 2. Ejecutar la base de datos

Abre Supabase Dashboard → SQL Editor.

Abre este archivo:

`supabase/migrations/0001_smaky_pos.sql`

Copia **todo su contenido**, pégalo en el SQL Editor y pulsa **Run**.

El SQL crea las tablas, índices, funciones, relaciones necesarias con Auth, políticas RLS y la vista segura que usa la pantalla de login.

### 3. Publicar la Edge Function

Supabase Dashboard → Edge Functions → crear una función llamada:

`admin-users`

Reemplaza el contenido de la función por:

`supabase/functions/admin-users/index.ts`

Después pulsa **Deploy**.

No pongas una `service_role` key en el frontend.

### 4. Configurar Render

En Render → Environment agrega exactamente estas variables:

`VITE_SUPABASE_URL`

Valor: la URL del proyecto Supabase.

`VITE_SUPABASE_PUBLISHABLE_KEY`

Valor: la clave pública `sb_publishable_...` del proyecto.

No agregues `SUPABASE_SERVICE_ROLE_KEY` a las variables del frontend de Render.

Build Command:

`npm run build`

Start Command:

`node server.cjs`

## Primer arranque del POS después de la integración

1. Abre el POS con internet.
2. Selecciona **Gerente**.
3. Usa el PIN `1234`.
4. El POS iniciará la sincronización y subirá a Supabase los datos locales existentes.
5. Las sesiones y usuarios remotos posteriores quedarán gestionados por Supabase Auth.

No necesitas insertar manualmente productos, clientes, pedidos o ventas existentes: el sincronizador utiliza los datos de Dexie como fuente local y los sube cuando el usuario tiene una sesión remota válida.

## Usuarios existentes

Los trabajadores creados anteriormente solamente en Dexie se migran automáticamente al primer inicio remoto del gerente, siempre que tengan un PIN válido de 4 dígitos.

Los usuarios creados desde **Usuarios** mientras haya conexión se crean directamente en Supabase Auth y en el perfil remoto.

## Offline

Dexie no se eliminó. El POS puede seguir utilizando sus datos locales cuando no hay conexión.

Cuando vuelve internet y existe una sesión remota válida, la sincronización se reanuda automáticamente.

## Tablas que sí utiliza este código

- `profiles`
- `products`
- `customers`
- `orders`
- `sales`
- `cash_closures`
- `settings`
- `audit_events`
- `history_records`

No se crearon tablas independientes para métodos de pago, categorías, detalle de pedido, detalle de venta, facturas, comandas o mesas porque el modelo actual del POS ya los maneja como datos anidados/configuración. Esto evita reconstruir el sistema y duplicar lógica.

Tampoco se creó una tabla de inventario independiente porque la pantalla actual de Inventario no utiliza todavía un almacén persistente de inventario en `store.ts`/Dexie. Crear una tabla ahora no conectaría ninguna funcionalidad real.

## GitHub

No subas `.env.local`.

El repositorio ya está configurado para ignorar `.env.local` y otros `.env.*`.

Sí se incluye `.env.example`, que solamente contiene los nombres de las variables sin credenciales.
