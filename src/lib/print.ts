import type { Order, Sale, SaleItem } from './types'
import { money, date, time } from './format'

const escapeHtml = (value: string | number | undefined | null) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')

const printWindow = (title: string, body: string, width = 460, target?: Window | null) => {
  const win = target ?? window.open('', '_blank', `width=${width},height=760`)
  if (!win) return false
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;padding:18px 14px;font-family:Arial,Helvetica,sans-serif;color:#1c1b1a;background:#f4efe9;font-size:12px}.sheet{width:100%;max-width:430px;margin:auto;background:#f8f5f1;border:1px solid #d9d1ca;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,.15)}.head{text-align:center;padding:22px 22px 16px;background:linear-gradient(180deg,#fffdfa,#f2ece6);border-bottom:1px dashed #c9c1ba}.mark{width:42px;height:42px;border-radius:13px;background:#171716;color:#f4efe9;display:grid;place-items:center;font-size:18px;font-weight:900;margin:0 auto 9px}.eyebrow{font-size:8px;font-weight:900;letter-spacing:1.3px;text-transform:uppercase;color:#a24728}.brand{font-size:22px;font-weight:900;letter-spacing:-.4px;margin-top:4px}.ref{font-size:9px;color:#77706b;margin-top:4px}.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #ddd5ce;background:#f7f3ee}.meta-cell{padding:11px 9px;border-right:1px solid #e2dbd4}.meta-cell:last-child{border-right:0}.meta-cell span,.meta-cell b{display:block}.meta-cell span{font-size:7px;color:#918983;text-transform:uppercase;letter-spacing:.6px}.meta-cell b{font-size:8px;margin-top:4px;line-height:1.3}.content{padding:4px 15px}.item{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px dashed #d9d1ca}.item:last-child{border-bottom:0}.item b,.item span{display:block}.item b{font-size:10px}.item span{font-size:8px;color:#887f79;margin-top:3px;line-height:1.35}.mod{color:#6d625c;font-size:8px!important;font-weight:700;margin-top:3px}.totals{padding:10px 15px 15px;border-top:2px solid #262523}.total-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0}.total-row span{font-size:9px;color:#7a726c}.total-row b{font-size:9px}.total-row.grand{padding-top:8px}.total-row.grand span{font-size:13px;font-weight:800;color:#2f2d2b}.total-row.grand strong{font-size:23px;font-weight:900}.note{margin:0 15px 15px;padding:8px 9px;border:1px solid #d1c8c0;border-radius:9px;background:#f2ece6;font-size:8px;line-height:1.4}.note b{font-size:7px;letter-spacing:.8px}.footer{text-align:center;padding:12px 15px 16px;border-top:1px dashed #c9c1ba;color:#8b837d;font-size:8px;font-weight:800;letter-spacing:.7px;text-transform:uppercase}@media print{body{padding:0;background:#fff}.sheet{max-width:none;width:100%;border:0;box-shadow:none;border-radius:0}}
  </style></head><body>${body}<script>window.onload=()=>{window.focus();window.print();setTimeout(()=>window.close(),350)}</script></body></html>`)
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
    <div class="line"></div>${groups}
    ${order.notes ? `<div class="note"><b>OBSERVACIONES</b><br>${escapeHtml(order.notes)}</div>` : ''}
    <div class="line"></div><div class="footer">Preparar pedido · verificar modificaciones</div>`, 460, target)
}

export function printSaleReceipt(sale: Sale, target?: Window | null) {
  const items = sale.items.map(item => `<div class="item"><div><b>${item.quantity}× ${escapeHtml(item.name)}</b><span>${escapeHtml(item.modification || item.category || 'Producto')}</span></div><strong>${money(item.total)}</strong></div>`).join('')
  const payment = sale.payment === 'cash' ? 'Efectivo' : sale.payment === 'transfer' ? 'Transferencia' : 'Tarjeta'
  return printWindow(`Comprobante #${sale.orderNumber ?? sale.id.slice(-6)}`, `
    <div class="sheet"><div class="head"><div class="mark">S</div><div class="eyebrow">FACTURA / COMPROBANTE</div><div class="brand">Smaky Burgers</div><div class="ref">Venta #${escapeHtml(sale.id.slice(-6).toUpperCase())}</div></div>
    <div class="meta-grid"><div class="meta-cell"><span>Pedido</span><b>#${escapeHtml(sale.orderNumber ?? sale.id.slice(-6).toUpperCase())}</b></div><div class="meta-cell"><span>Cliente</span><b>${escapeHtml(sale.customerName || 'Consumidor final')}</b></div><div class="meta-cell"><span>Pago</span><b>${escapeHtml(payment)}</b></div><div class="meta-cell"><span>Fecha</span><b>${escapeHtml(date(sale.createdAt))} · ${escapeHtml(time(sale.createdAt))}</b></div></div>
    <div class="content">${items}</div>
    <div class="totals"><div class="total-row"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div><div class="total-row grand"><span>Total</span><strong>${money(sale.total)}</strong></div></div>
    ${sale.notes ? `<div class="note"><b>OBSERVACIONES</b><br>${escapeHtml(sale.notes)}</div>` : ''}<div class="footer">Gracias por tu compra · Smaky POS</div></div>`, 460, target)
}
