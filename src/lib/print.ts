import type { CashClosure, Order, Sale } from './types'

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const cop = (value: number) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(Number(value) || 0)

const safeFontSize = (value: number | undefined, fallback = 10) =>
  Math.max(4, Math.min(20, Number(value) || fallback))

const baseHtml = (title: string, fontSize: number, body: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page{size:58mm auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}
.receipt{width:58mm;padding:4.5mm 3.5mm 7mm;font-size:${safeFontSize(fontSize)}px;line-height:1.28}
.center{text-align:center}.brand{font-weight:900;font-size:1.5em;letter-spacing:.15px}.title{font-weight:900;font-size:1.08em;letter-spacing:.8px;margin-top:1.5mm}.muted{color:#555;font-size:.84em}.rule{border:0;border-top:1px dashed #777;margin:3mm 0}.row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.row>span{min-width:0}.row>strong{white-space:nowrap}.strong{font-weight:900}.item{padding:1.8mm 0;border-bottom:1px dotted #bbb}.item:last-child{border-bottom:0}.item-name{font-weight:700;max-width:70%;overflow-wrap:anywhere}.total{font-weight:900;font-size:1.28em;margin-top:2mm}.small{font-size:.78em;color:#555}.footer{margin-top:4mm;text-align:center;font-size:.76em;color:#555;line-height:1.35}.section-label{font-size:.78em;font-weight:900;letter-spacing:1px;color:#444;margin-bottom:1.5mm}.summary-card{border:1px solid #999;padding:2.3mm 2.4mm;border-radius:1.5mm}.summary-card+.summary-card{margin-top:2.5mm}.summary-line{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:baseline;column-gap:7px;padding:1.4mm 0;border-bottom:1px solid #ddd}.summary-line:last-child{border-bottom:0}.summary-label{min-width:0;white-space:normal;word-break:normal;overflow-wrap:break-word}.summary-line>strong{white-space:nowrap}.summary-count{display:block;font-size:.72em;color:#666;margin-top:.25mm}.payment-name{font-weight:700;word-break:normal;overflow-wrap:break-word}.cash-check{padding-top:.4mm}.cash-check .summary-line{border-bottom:0;padding:1.15mm 0}.difference{margin-top:1.8mm;padding:2mm 2.2mm;border:1px solid #555;text-align:center;font-weight:900;letter-spacing:.5px}.difference.ok{border-color:#222}.notes{margin-top:2.5mm;padding-top:2.2mm;border-top:1px solid #bbb}.notes-value{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:1mm}.meta{font-size:.8em;line-height:1.45}.signature{margin-top:5mm;text-align:center}.signature-line{border-top:1px solid #777;width:70%;margin:0 auto 1.2mm}
/* Cierre térmico: evitar que los rótulos se partan carácter por carácter en impresoras de 58 mm. */
.closure-summary .summary-line{grid-template-columns:minmax(0,1fr) max-content;column-gap:5px}
.closure-summary .summary-label{display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.closure-summary .summary-line>strong{display:block;text-align:right;white-space:nowrap}
.closure-summary .section-label{margin-bottom:1mm}
.closure-summary .payment-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.closure-summary .summary-line{padding:1.1mm 0}

@media print{.no-print{display:none!important}}
</style></head><body><main class="receipt">${body}</main><script>window.onload=()=>{setTimeout(()=>window.print(),100)};window.onafterprint=()=>window.close()</script></body></html>`

export function printSaleReceipt(sale: Sale, fontSize = 10, copyLabel = 'COPIA') {
  const safeSize = safeFontSize(fontSize)
  const popup = window.open('', '_blank', 'width=420,height=720')
  if (!popup) return false
  const items = sale.items.map(item => `<div class="item"><div class="row"><span class="item-name">${esc(item.quantity)}× ${esc(item.name)}</span><strong>${cop(item.total)}</strong></div><div class="small">${cop(item.unitPrice)} c/u</div></div>`).join('')
  const body = `<div class="center"><div class="brand">Smaky Burgers</div><div class="title">COMPROBANTE · ${esc(copyLabel)}</div><div class="muted">Pedido #${esc(sale.orderNumber ?? sale.id.slice(-6).toUpperCase())}</div></div><hr class="rule"><div class="meta">Fecha: ${esc(new Date(sale.createdAt).toLocaleString('es-CO'))}<br>Atendido por: ${esc(sale.userName)}<br>Cliente: ${esc(sale.customerName || 'Consumidor final')}</div><hr class="rule">${items}<hr class="rule"><div class="row"><span>Subtotal</span><strong>${cop(sale.subtotal)}</strong></div>${sale.discountAmount ? `<div class="row"><span>Descuento</span><strong>-${cop(sale.discountAmount)}</strong></div>` : ''}<div class="row total"><span>TOTAL</span><strong>${cop(sale.total)}</strong></div><div class="footer">Gracias por tu compra · Smaky POS</div>`
  popup.document.open()
  popup.document.write(baseHtml(`Factura ${sale.orderNumber ?? sale.id}`, safeSize, body))
  popup.document.close()
  return true
}

export function printOrderComanda(order: Order, fontSize = 10) {
  const safeSize = safeFontSize(fontSize)
  const popup = window.open('', '_blank', 'width=420,height=720')
  if (!popup) return false
  const items = order.items.map(item => `<div class="item"><div class="row"><span class="item-name">${esc(item.quantity)}× ${esc(item.name)}</span><strong>${cop(item.total)}</strong></div>${item.modification ? `<div class="small">Mod: ${esc(item.modification)}</div>` : ''}</div>`).join('')
  const body = `<div class="center"><div class="brand">COMANDA</div><div class="muted">Pedido #${esc(order.orderNumber)}</div></div><hr class="rule"><div class="meta">${esc(new Date(order.createdAt).toLocaleString('es-CO'))}<br>Cliente: ${esc(order.customerName || 'Consumidor final')}<br>Dirección: ${esc(order.address || '—')}</div><hr class="rule">${items}${order.notes ? `<hr class="rule"><div><div class="section-label">OBSERVACIONES</div><div>${esc(order.notes)}</div></div>` : ''}<div class="footer">Smaky POS · Comanda de cocina</div>`
  popup.document.open()
  popup.document.write(baseHtml(`Comanda ${order.orderNumber}`, safeSize, body))
  popup.document.close()
  return true
}

export function printCashClosingReceipt(closure: CashClosure, fontSize = 10) {
  const safeSize = safeFontSize(fontSize)
  const popup = window.open('', '_blank', 'width=420,height=760')
  if (!popup) return false

  const fallbackLabels: Record<string, string> = {
    cash: 'Efectivo',
    transfer: 'Transferencia',
    card: 'Tarjeta',
  }
  const payments = closure.payments && Object.keys(closure.payments).length
    ? closure.payments
    : { cash: closure.cash, transfer: closure.transfer, card: closure.card }

  const paymentRows = Object.entries(payments)
    .map(([id, amount]) => {
      const numericAmount = Number(amount) || 0
      const count = Array.isArray(closure.sales)
        ? closure.sales.filter(sale => sale.payment === id && !sale.deletedAt).length
        : 0
      const fallbackFromSales = count > 0 ? (closure.sales.find(sale => sale.payment === id && sale.paymentLabel)?.paymentLabel || '') : ''
      const label = closure.paymentLabels?.[id] || fallbackFromSales || fallbackLabels[id] || id
      return {
        id,
        label,
        amount: numericAmount,
        count,
      }
    })
    .filter(item => item.amount !== 0 || item.count > 0)
    .sort((a, b) => {
      const order: Record<string, number> = { cash: 0, transfer: 1, card: 2 }
      return (order[a.id] ?? 10) - (order[b.id] ?? 10) || a.label.localeCompare(b.label, 'es')
    })

  const paymentHtml = paymentRows.length
    ? paymentRows.map(item => `<div class="summary-line"><span class="summary-label"><span class="payment-name">${esc(item.label)}</span>${item.count ? `<span class="summary-count">${item.count} ${item.count === 1 ? 'movimiento' : 'movimientos'}</span>` : ''}</span><strong>${cop(item.amount)}</strong></div>`).join('')
    : `<div class="summary-line"><span class="summary-label"><span class="payment-name">Sin movimientos</span></span><strong>${cop(0)}</strong></div>`

  const difference = Number(closure.cashDifference) || 0
  const differenceLabel = difference === 0 ? 'CUADRE EXACTO' : difference > 0 ? 'SOBRANTE' : 'FALTANTE'
  const differenceClass = difference === 0 ? ' ok' : ''
  const differenceAmount = Math.abs(difference)
  const nextDate = closure.nextDateKey ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' }).format(new Date(`${closure.nextDateKey}T12:00:00`)) : '—'

  const body = `
    <div class="center">
      <div class="brand">Smaky Burgers</div>
      <div class="title">CIERRE DE CAJA</div>
      <div class="muted">Comprobante administrativo</div>
    </div>
    <hr class="rule">
    <div class="meta">
      <strong>Período:</strong> ${esc(closure.dateKey)}<br>
      <strong>Cierre:</strong> ${esc(new Date(closure.closedAt).toLocaleString('es-CO'))}<br>
      <strong>Responsable:</strong> ${esc(closure.userName)}
    </div>

    <hr class="rule">
    <div class="section-label">RESUMEN DEL PERÍODO</div>
    <div class="summary-card closure-summary">
      <div class="summary-line"><span class="summary-label">Ventas registradas</span><strong>${esc(closure.saleCount)}</strong></div>
      <div class="summary-line"><span class="summary-label">TOTAL VENTAS</span><strong>${cop(closure.total)}</strong></div>
    </div>

    <div class="summary-card closure-summary">
      <div class="section-label">MEDIOS DE PAGO</div>
      ${paymentHtml}
    </div>

    <div class="summary-card cash-check closure-summary">
      <div class="section-label">ARQUEO DE EFECTIVO</div>
      <div class="summary-line"><span class="summary-label">Efectivo esperado</span><strong>${cop(closure.cashExpected)}</strong></div>
      <div class="summary-line"><span class="summary-label">Efectivo contado</span><strong>${cop(closure.cashCounted)}</strong></div>
      <div class="difference${differenceClass}">${esc(differenceLabel)}<br>${cop(differenceAmount)}</div>
    </div>

    ${closure.notes ? `<div class="notes"><div class="section-label">OBSERVACIONES</div><div class="notes-value">${esc(closure.notes)}</div></div>` : ''}

    <hr class="rule">
    <div class="summary-card closure-summary">
      <div class="section-label">PERÍODO SIGUIENTE</div>
      <div class="strong">${esc(closure.nextDateKey || '—')}</div>
      <div class="small">${esc(nextDate)}</div>
    </div>

    <div class="signature">
      <div class="signature-line"></div>
      <div class="small">Responsable del cierre</div>
    </div>
    <div class="footer">Smaky POS · Cierre interno de caja<br>Documento generado para control administrativo</div>
  `

  popup.document.open()
  popup.document.write(baseHtml(`Cierre de caja ${closure.dateKey}`, safeSize, body))
  popup.document.close()
  return true
}
