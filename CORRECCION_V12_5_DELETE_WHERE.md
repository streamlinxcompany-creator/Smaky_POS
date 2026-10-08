# v12.5 – Corrección del reinicio POS Virgen

Se corrige el error `DELETE requires a WHERE clause` que podía aparecer al
pulsar el reinicio global de StreamLinx. La función RPC ahora usa `WHERE true`
en todas las eliminaciones globales, sin depender de DELETE sin WHERE.

La migración es `0016_streamlinx_pos_virgin_require_where.sql`.
