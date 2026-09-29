import type { Order, Sale } from './types'
import { money, date, time } from './format'

const printWindow = (title: string, body: string, width = 420, target?: Window | null) => {
  const win = target ?? window.open('', '_blank', `width=${width},height=720`)
  if (!win) return false
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    *{box-sizing:border-box}body{margin:0;padding:16px;font-family:Arial,sans-serif;color:#111;font-size:12px}.ticket{width:100%;max-width:380px;margin:auto}.center{text-align:center}.brand{font-size:22px;font-weight:800;margin-bottom:2px}.muted{color:#666;font-size:10px}.row{display:flex;justify-content:space-between;gap:10px}.line{border-top:1px dashed #999;margin:10px 0}.item{padding:7px 0;border-bottom:1px dotted #bbb}.item:last-child{border-bottom:0}.item strong{font-size:12px}.item small{display:block;color:#666;margin-top:2px}.total{font-size:18px;font-weight:800}.label{color:#666;text-transform:uppercase;font-size:9px;letter-spacing:.5px}h1{font-size:16px;margin:4px 0 8px}.note{white-space:pre-wrap;background:#f4f4f4;padding:8px;margin-top:9px;border-radius:4px}@media print{body{padding:0}.ticket{max-width:none;width:100%}}
  </style></head><body><div class="ticket">${body}</div><script>window.onload=()=>{window.focus();window.print();setTimeout(()=>window.close(),300)}</script></body></html>`)
  win.document.close()
  return true
}

export function printOrderComanda(order: Order, target?: Window | null) {
  const items = order.items.map(item => `<div class="item"><div class="row"><strong>${item.quantity}× ${item.name}</strong><strong>${money(item.total)}</strong></div><small>${money(item.unitPrice)} c/u</small></div>`).join('')
  return printWindow(`Comanda #${order.orderNumber}`, `
    <div class="center"><div class="brand">SMAKY</div><div class="muted">COMANDA · PEDIDO #${order.orderNumber}</div><div class="muted">${date(order.createdAt)} · ${time(order.createdAt)}</div></div>
    <div class="line"></div><div class="label">Cliente</div><div style="font-weight:700;margin:3px 0 6px">${order.customerName}</div>
    <div class="row"><div><div class="label">Teléfono</div>${order.phone || '—'}</div><div style="text-align:right"><div class="label">Atiende</div>${order.userName}</div></div>
    <div style="margin-top:8px"><div class="label">Dirección</div><div>${order.address}</div></div>
    <div class="line"></div><h1>Productos</h1>${items}${order.notes ? `<div class="note"><b>Observaciones:</b><br>${order.notes}</div>` : ''}
    <div class="line"><div class="row"><span class="label">Total pedido</span><strong class="total">${money(order.total)}</strong></div></div>`, 420, target)
}

export function printSaleReceipt(sale: Sale, target?: Window | null) {
  const items = sale.items.map(item => `<div class="item"><div class="row"><strong>${item.quantity}× ${item.name}</strong><strong>${money(item.total)}</strong></div><small>${money(item.unitPrice)} c/u</small></div>`).join('')
  const payment = sale.payment === 'cash' ? 'Efectivo' : sale.payment === 'transfer' ? 'Transferencia' : 'Tarjeta'
  return printWindow(`Comprobante #${sale.orderNumber ?? sale.id.slice(-6)}`, `
    <div class="center"><div class="brand">SMAKY</div><div class="muted">FACTURA / COMPROBANTE</div><div class="muted">${sale.orderNumber ? `Pedido #${sale.orderNumber} · ` : ''}${date(sale.createdAt)} · ${time(sale.createdAt)}</div></div>
    <div class="line"></div><div class="row"><div><div class="label">Cliente</div><strong>${sale.customerName}</strong></div><div style="text-align:right"><div class="label">Pago</div><strong>${payment}</strong></div></div>
    <div style="margin-top:8px"><div class="label">Dirección</div><div>${sale.address}</div></div>
    <div class="line"><h1>Productos</h1>${items}</div>
    <div class="row"><span>Subtotal</span><strong>${money(sale.subtotal)}</strong></div>
    <div style="margin-top:8px" class="row"><span class="label">Total</span><strong class="total">${money(sale.total)}</strong></div>
    ${sale.notes ? `<div class="note"><b>Observaciones:</b><br>${sale.notes}</div>` : ''}
    <div class="center muted" style="margin-top:18px">Gracias por tu compra · Smaky POS</div>`, 420, target)
}
