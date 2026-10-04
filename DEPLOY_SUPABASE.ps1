$ErrorActionPreference = 'Stop'

Write-Host 'Smaky POS - deploy de Edge Function admin-users' -ForegroundColor Cyan
Write-Host ''
Write-Host '1) Si todavía no has iniciado sesión:'
Write-Host '   supabase login'
Write-Host ''
Write-Host '2) Enlazando proyecto: jipmbegkgxnlqthmbvpp'
supabase link --project-ref jipmbegkgxnlqthmbvpp
Write-Host ''
Write-Host '3) Desplegando admin-users...'
supabase functions deploy admin-users
Write-Host ''
Write-Host 'Listo. La función usa las claves que Supabase inyecta en el entorno de Edge Functions.' -ForegroundColor Green
