# Corrección v9 — impresión del cierre de caja

Se corrigió la impresión térmica de `src/lib/print.ts`.

## Problema
En impresoras térmicas de 58 mm, las filas de resumen usaban `display:flex` con un label que podía reducirse demasiado. El motor de impresión terminaba partiendo palabras carácter por carácter (`Ef / ec / ti / vo`).

## Solución
- Las filas `summary-line` del comprobante usan CSS Grid con dos columnas: descripción + valor.
- Los importes quedan siempre sin salto de línea.
- Las etiquetas del cierre no se parten por caracteres.
- Los medios de pago largos se recortan con `…` en vez de deformar el ticket.
- Se mantiene el mismo ancho térmico de 58 mm usado por factura y comanda.
- No se cambia la lógica de ventas, cierres ni sincronización: solo la plantilla de impresión.
