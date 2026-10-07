# Panel de cobro — actualización

- El modal de cobro ahora usa un ancho de escritorio de hasta 1040px.
- La información se organiza en dos columnas: pedido/cliente/medios de pago a la izquierda y total/descuento/estado a la derecha.
- Para Efectivo aparece un módulo de arqueo de cambio con:
  - efectivo recibido
  - total a cobrar
  - valor a devolver
  - valor faltante cuando el efectivo es insuficiente
  - montos rápidos (exacto y valores redondeados)
- El control de confirmación queda bloqueado hasta que el efectivo recibido sea suficiente cuando el medio de pago es Efectivo.
- El cálculo del cambio no altera ni guarda el pedido: solo facilita el cobro antes de registrar la venta.
- Se limpiaron 210 sufijos `None` inválidos que estaban en `global.css` y podían dejar reglas de tipografía sin efecto.
