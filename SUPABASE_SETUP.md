# Smaky POS — configuración final Cloudflare + Supabase

Este proyecto ya está preparado para usar Supabase desde el frontend y una Edge Function para operaciones administrativas.

## 1. Supabase: ejecutar la base de datos

En el Dashboard de Supabase:

`SQL Editor` → `New query`

Ejecuta COMPLETO:

`supabase/migrations/0001_smaky_pos.sql`

El script crea las tablas, RLS, funciones auxiliares, trigger de perfiles y la vista `pos_login_profiles`.

## 2. Supabase: crear el gerente inicial

En:

`Authentication` → `Users` → `Add user`

Crear:

- Email: `u-owner@smaky.local`
- Password: `SmakyPOS#1234`
- Confirm/Auto Confirm: activado

El SQL de este proyecto reconoce ese correo y crea el perfil `manager`.

En la pantalla de Smaky POS el acceso será:

- Perfil: `Gerente`
- PIN: `1234`

## 3. Supabase: Edge Function

Crear/desplegar una función llamada exactamente:

`admin-users`

Usar el archivo:

`supabase/functions/admin-users/index.ts`

La función usa:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEYS`
- `SUPABASE_SECRET_KEYS`

Supabase Hosted Edge Functions proporciona esas variables automáticamente. La secret key no se copia al navegador ni al código frontend.

URL de la función:

`https://jipmbegkgxnlqthmbvpp.supabase.co/functions/v1/admin-users`

## 4. Cloudflare Pages

Configuración de build:

- Build command: `npm run build`
- Output directory: `dist`

Variables de entorno de producción:

`VITE_SUPABASE_URL`

`https://jipmbegkgxnlqthmbvpp.supabase.co`

`VITE_SUPABASE_PUBLISHABLE_KEY`

`sb_publishable_-zmFxlip9lpmMseQwtAZ2Q_Wns2hb5Q`

No agregues una variable `VITE_...` con una `sb_secret_...`.

## 5. Orden exacto

1. Ejecutar el SQL.
2. Crear el usuario `u-owner@smaky.local`.
3. Desplegar `admin-users`.
4. Configurar las dos variables en Cloudflare.
5. Hacer un nuevo deploy de Cloudflare.
6. Abrir la página e iniciar sesión como `Gerente` con PIN `1234`.

## 6. Verificación

En Supabase revisa:

- Authentication → Users: debe existir `u-owner@smaky.local`.
- Table Editor → `profiles`: debe aparecer el gerente.
- Edge Functions: `admin-users` debe estar desplegada.

El frontend utiliza una clave publishable, que está diseñada para exponerse en aplicaciones web cuando RLS protege los datos. La secret key solo se utiliza en la Edge Function.
