import type { Order, Sale } from './types'

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const cop = (value: number) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(value || 0)

const baseHtml = (title: string, fontSize: number, body: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}
.receipt{width:58mm;padding:5mm 3.5mm 7mm;font-size:${Math.max(8, Math.min(18, fontSize))}px;line-height:1.28}.center{text-align:center}.brand{font-weight:900;font-size:1.45em}.muted{color:#555;font-size:.86em}.rule{border:0;border-top:1px dashed #777;margin:3mm 0}.row{display:flex;justify-content:space-between;gap:8px}.item{padding:2mm 0;border-bottom:1px dotted #bbb}.item:last-child{border-bottom:0}.item-name{font-weight:700;max-width:70%;overflow-wrap:anywhere}.total{font-weight:900;font-size:1.3em;margin-top:2mm}.small{font-size:.78em;color:#555}.footer{margin-top:4mm;text-align:center;font-size:.78em;color:#555}
@media print{.no-print{display:none!important}}
</style></head><body><main class="receipt">${body}</main><script>window.onload=()=>{setTimeout(()=>window.print(),100)};window.onafterprint=()=>window.close()</script></body></html>`

function openPrinter(title: string, build: (fontSize: number) => string) {
  const popup = window.open('', '_blank', 'width=420,height=720')
  if (!popup) return false
  // Do not block the click with an async operation. A fixed, safe thermal size
  // keeps printing reliable even when a popup blocker is strict.
  popup.document.open()
  popup.document.write(baseHtml(title, 10, build(10)))
  popup.document.close()
  return true
}

export function printSaleReceipt(sale: Sale, fontSize = 10, copyLabel = 'COPIA') {
  const safeSize = Math.max(8, Math.min(18, Number(fontSize) || 10))
  const popup = window.open('', '_blank', 'width=420,height=720')
  if (!popup) return false
  const items = sale.items.map(item => `<div class="item"><div class="row"><span class="item-name">${esc(item.quantity)}× ${esc(item.name)}</span><strong>${cop(item.total)}</strong></div><div class="small">${cop(item.unitPrice)} c/u</div></div>`).join('')
  const body = `<div class="center"><div class="brand">Smaky Burgers</div><div class="muted">COMPROBANTE · ${esc(copyLabel)}</div><div class="muted">Pedido #${esc(sale.orderNumber ?? sale.id.slice(-6).toUpperCase())}</div></div><hr class="rule"><div class="small">Fecha: ${esc(new Date(sale.createdAt).toLocaleString('es-CO'))}</div><div class="small">Atendido por: ${esc(sale.userName)}</div><div class="small">Cliente: ${esc(sale.customerName || 'Consumidor final')}</div><hr class="rule">${items}<hr class="rule"><div class="row"><span>Subtotal</span><strong>${cop(sale.subtotal)}</strong></div>${sale.discountAmount ? `<div class="row"><span>Descuento</span><strong>-${cop(sale.discountAmount)}</strong></div>` : ''}<div class="row total"><span>TOTAL</span><strong>${cop(sale.total)}</strong></div><div class="footer">Gracias por tu compra · Smaky POS</div>`
  popup.document.open()
  popup.document.write(baseHtml(`Factura ${sale.orderNumber ?? sale.id}`, safeSize, body))
  popup.document.close()
  return true
}

export function printOrderComanda(order: Order, fontSize = 10) {
  const safeSize = Math.max(8, Math.min(18, Number(fontSize) || 10))
  const popup = window.open('', '_blank', 'width=420,height=720')
  if (!popup) return false
  const items = order.items.map(item => `<div class="item"><div class="row"><span class="item-name">${esc(item.quantity)}× ${esc(item.name)}</span><strong>${cop(item.total)}</strong></div>${item.modification ? `<div class="small">Mod: ${esc(item.modification)}</div>` : ''}</div>`).join('')
  const body = `<div class="center"><div class="brand">COMANDA</div><div class="muted">Pedido #${esc(order.orderNumber)}</div></div><hr class="rule"><div class="small">${esc(new Date(order.createdAt).toLocaleString('es-CO'))}</div><div class="small">Cliente: ${esc(order.customerName || 'Consumidor final')}</div><div class="small">Dirección: ${esc(order.address || '—')}</div><hr class="rule">${items}${order.notes ? `<hr class="rule"><div><strong>Observaciones</strong><div class="small">${esc(order.notes)}</div></div>` : ''}<div class="footer">Smaky POS · Comanda de cocina</div>`
  popup.document.open()
  popup.document.write(baseHtml(`Comanda ${order.orderNumber}`, safeSize, body))
  popup.document.close()
  return true
}
