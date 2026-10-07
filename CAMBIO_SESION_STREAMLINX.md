# Corrección de sesión StreamLinx

Se corrigió el mensaje `No hay una sesión activa.` que aparecía al intentar borrar ventas desde StreamLinx.

## Comportamiento nuevo
- El acceso correcto al centro StreamLinx crea una sesión independiente (`streamlinx-session`).
- Las operaciones de StreamLinx usan como actor al primer usuario administrativo activo con permiso `sales.delete`, priorizando `u-owner`.
- No se reutiliza `smaky-session` y no se solicita el PIN de Gerente.
- Entrar directamente a `/streamlinx` sin haber autenticado StreamLinx redirige a `/login`.
- Salir del centro elimina la sesión independiente.

## Flujo
1. En Login: `Shift + Alt + X`.
2. Introducir el PIN de acceso de StreamLinx.
3. Entrar a `Invoices`.
4. Elegir `Borrar definitivamente` o `Borrar todas las ventas`.
5. No aparece ningún segundo PIN de Gerente.
