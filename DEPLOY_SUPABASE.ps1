$ErrorActionPreference = 'Stop'

Write-Host 'Smaky POS - deploy de Edge Function admin-users' -ForegroundColor Cyan
Write-Host ''
Write-Host '1) Si todavía no has iniciado sesión:'
Write-Host '   npx supabase login'
Write-Host ''
Write-Host '2) Enlazando proyecto: jipmbegkgxnlqthmbvpp'
npx supabase link --project-ref jipmbegkgxnlqthmbvpp
Write-Host ''
Write-Host '3) Aplicando migraciones SQL (incluye soporte offline/outbox)...' -ForegroundColor Cyan
npx supabase db push
Write-Host ''
Write-Host '4) Desplegando admin-users...' -ForegroundColor Cyan
npx supabase functions deploy admin-users
Write-Host ''
Write-Host 'Listo. La función usa las claves que npx supabase inyecta en el entorno de Edge Functions.' -ForegroundColor Green
