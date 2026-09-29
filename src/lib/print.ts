import type { Order, Sale, SaleItem } from './types'
import { money, date, time } from './format'

const escapeHtml = (value: string | number | undefined | null) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')

const printWindow = (title: string, body: string, width = 460, target?: Window | null) => {
  const win = target ?? window.open('', '_blank', `width=${width},height=760`)
  if (!win) return false
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;padding:14px 12px;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;font-size:12px}.ticket{width:100%;max-width:390px;margin:auto}.center{text-align:center}.brand{font-size:24px;font-weight:900;letter-spacing:.5px}.subbrand{font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px}.meta{font-size:9px;color:#555;margin-top:4px}.line{border-top:2px solid #111;margin:10px 0}.dashed{border-top:1px dashed #777;margin:9px 0}.order-no{font-size:25px;font-weight:900;letter-spacing:.5px;margin:5px 0}.section{font-size:10px;font-weight:900;letter-spacing:1.3px;text-transform:uppercase;margin:10px 0 4px}.item{padding:5px 0;border-bottom:1px dotted #bbb}.item:last-child{border-bottom:0}.item-row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.qty{font-size:14px;font-weight:900;white-space:nowrap}.name{font-size:13px;font-weight:800;line-height:1.25}.kind{display:block;font-size:8px;font-weight:700;color:#666;text-transform:uppercase;margin-top:2px}.mod{display:block;margin:4px 0 0 28px;font-size:10px;font-weight:700;line-height:1.35}.note{white-space:pre-wrap;border:1px solid #bbb;padding:7px;font-size:10px;margin-top:9px}.footer{margin-top:14px;text-align:center;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.8px}@media print{body{padding:0}.ticket{max-width:none;width:100%}}
  </style></head><body><div class="ticket">${body}</div><script>window.onload=()=>{window.focus();window.print();setTimeout(()=>window.close(),350)}</script></body></html>`)
  win.document.close()
  return true
}

const categoryOrder = ['Combos', 'Hamburguesas', 'Acompañamientos', 'Bebidas']

const groupedItems = (items: SaleItem[]) => categoryOrder
  .map(category => ({ category, items: items.filter(item => (item.category || '') === category) }))
  .filter(group => group.items.length)

const commandItem = (item: SaleItem) => `<div class="item"><div class="item-row"><div style="display:flex;gap:8px;min-width:0"><span class="qty">${item.quantity}×</span><div><div class="name">${escapeHtml(item.name)}</div><span class="kind">${escapeHtml(item.category || 'Producto')}</span></div></div></div>${item.modification ? `<span class="mod">MOD: ${escapeHtml(item.modification)}</span>` : ''}</div>`

export function printOrderComanda(order: Order, target?: Window | null) {
  const groups = groupedItems(order.items).map(group => `<div class="section">${escapeHtml(group.category)}</div>${group.items.map(commandItem).join('')}`).join('')
  return printWindow(`Comanda Pedido ${order.orderNumber}`, `
    <div class="center"><div class="brand">SMAKY</div><div class="subbrand">Comanda de cocina</div><div class="order-no">PEDIDO #${escapeHtml(order.orderNumber)}</div><div class="meta">${escapeHtml(date(order.createdAt))} · ${escapeHtml(time(order.createdAt))} · ${escapeHtml(order.userName)}</div></div>
    <div class="line"></div>${groups}<div class="dashed"></div>
    <div class="item-row"><strong>TOTAL UNIDADES</strong><strong>${order.items.reduce((sum, item) => sum + item.quantity, 0)}</strong></div>
    ${order.notes ? `<div class="note"><b>OBSERVACIONES</b><br>${escapeHtml(order.notes)}</div>` : ''}
    <div class="line"></div><div class="footer">Preparar pedido · verificar modificaciones</div>`, 460, target)
}

export function printSaleReceipt(sale: Sale, target?: Window | null) {
  const items = sale.items.map(item => `<div class="item"><div class="item-row"><div style="display:flex;gap:8px;min-width:0"><span class="qty">${item.quantity}×</span><div><div class="name">${escapeHtml(item.name)}</div><span class="kind">${escapeHtml(item.category || 'Producto')}</span></div></div><strong>${money(item.total)}</strong></div>${item.modification ? `<span class="mod">MOD: ${escapeHtml(item.modification)}</span>` : ''}</div>`).join('')
  const payment = sale.payment === 'cash' ? 'Efectivo' : sale.payment === 'transfer' ? 'Transferencia' : 'Tarjeta'
  return printWindow(`Comprobante #${sale.orderNumber ?? sale.id.slice(-6)}`, `
    <div class="center"><div class="brand">SMAKY</div><div class="subbrand">Factura / comprobante</div><div class="order-no">${sale.orderNumber ? `PEDIDO #${escapeHtml(sale.orderNumber)}` : 'VENTA'}</div><div class="meta">${escapeHtml(date(sale.createdAt))} · ${escapeHtml(time(sale.createdAt))}</div></div>
    <div class="line"></div><div class="item-row"><div><div class="kind">Atendido por</div><strong>${escapeHtml(sale.userName)}</strong></div><div style="text-align:right"><div class="kind">Pago</div><strong>${payment}</strong></div></div>
    <div class="dashed"></div>${items}
    <div class="line"></div><div class="item-row"><span>Total</span><strong style="font-size:20px">${money(sale.total)}</strong></div>
    ${sale.notes ? `<div class="note"><b>OBSERVACIONES</b><br>${escapeHtml(sale.notes)}</div>` : ''}<div class="footer">Gracias por tu compra · Smaky POS</div>`, 460, target)
}
