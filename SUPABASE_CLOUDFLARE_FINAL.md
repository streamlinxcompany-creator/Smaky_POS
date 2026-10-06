# Smaky POS — conexión Supabase + Cloudflare

## Cloudflare Pages

Build command:

    npm run build

Output directory:

    dist

Variables de entorno de producción:

    VITE_SUPABASE_URL=https://jipmbegkgxnlqthmbvpp.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_-zmFxlip9lpmMseQwtAZ2Q_Wns2hb5Q

El frontend usa únicamente la publishable key.

## Supabase

1. Aplica en orden `0001_smaky_pos.sql`, `0002_invoice_settings_permission.sql` y `0003_offline_sync.sql` (o usa `supabase db push`).
2. En Authentication > Users crea `u-owner@smaky.local` y confirma el usuario.
3. Despliega `supabase/functions/admin-users/index.ts` como la función `admin-users`.

La Edge Function lee automáticamente `SUPABASE_SECRET_KEYS` y `SUPABASE_PUBLISHABLE_KEYS` cuando está desplegada en Supabase. No debes copiar la `sb_secret_...` al frontend ni a Cloudflare Pages.

URL de la función:

    https://jipmbegkgxnlqthmbvpp.supabase.co/functions/v1/admin-users

## Login inicial

Perfil: Gerente
PIN: 1234

El código convierte el PIN en la contraseña de Auth `SmakyPOS#1234`.
