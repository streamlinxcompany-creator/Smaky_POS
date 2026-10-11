import type { CashClosure, Order, Sale } from './types'

type PaperWidth = 58 | 80 | 88

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const cop = (value: number) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(Number(value) || 0)

const safeFontSize = (value: number | undefined, fallback = 11) =>
  Math.max(7, Math.min(18, Math.round(Number(value) || fallback)))

const safePaperWidth = (value: number | undefined): PaperWidth =>
  value === 80 || value === 88 ? value : 58

/** The nominal roll is wider than its guaranteed printable area. */
const printableWidth = (paperWidth: PaperWidth) => paperWidth === 58 ? 52.5 : paperWidth === 80 ? 72 : 80

const baseHtml = (title: string, fontSize: number, body: string, requestedWidth = 58) => {
  const paperWidth = safePaperWidth(requestedWidth)
  const contentWidth = printableWidth(paperWidth)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
@page{size:${paperWidth}mm auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0!important;padding:0!important;width:${contentWidth}mm;min-width:${contentWidth}mm;background:#fff!important;color:#000!important;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{overflow:visible}
.receipt{width:${contentWidth}mm;max-width:${contentWidth}mm;margin:0;padding:3.2mm 2.8mm 5mm;background:#fff;color:#000;font-size:${safeFontSize(fontSize)}px;line-height:1.32;overflow-wrap:break-word}
*{color:#000!important}
.center{text-align:center}.brand{font-weight:900;font-size:1.5em;letter-spacing:.1px}.title{font-weight:900;font-size:1.12em;letter-spacing:.45px;margin-top:1.5mm}.muted{font-size:.9em}.rule{border:0;border-top:1px dashed #000;margin:2.7mm 0}.row{display:flex;justify-content:space-between;align-items:baseline;gap:3mm}.row>span{min-width:0;overflow-wrap:anywhere}.row>strong{white-space:nowrap;flex:none}.strong{font-weight:900}.item{padding:1.8mm 0;border-bottom:1px dotted #000;break-inside:avoid}.item:last-child{border-bottom:0}.item-name{font-weight:700;min-width:0;overflow-wrap:anywhere}.total{font-weight:900;font-size:1.28em;margin-top:2mm;padding-top:1.8mm;border-top:1px solid #000}.small{font-size:.86em}.footer{margin-top:3.5mm;text-align:center;font-size:.82em;line-height:1.35}.section-label{font-size:.82em;font-weight:900;letter-spacing:.4px;margin-bottom:1.4mm}.summary-card{border:1px solid #000;padding:2mm 2.3mm;border-radius:0}.summary-card+.summary-card{margin-top:2.3mm}.summary-line{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:baseline;column-gap:3mm;padding:1.4mm 0;border-bottom:1px solid #000}.summary-line:last-child{border-bottom:0}.summary-label{min-width:0;white-space:normal;word-break:normal;overflow-wrap:anywhere}.summary-line>strong{white-space:nowrap}.summary-count{display:block;font-size:.78em;margin-top:.3mm}.payment-name{font-weight:700;word-break:normal;overflow-wrap:anywhere}.cash-check{padding-top:.4mm}.cash-check .summary-line{padding:1.15mm 0}.difference{margin-top:1.8mm;padding:2mm;border:1px solid #000;text-align:center;font-weight:900;letter-spacing:.2px}.notes{margin-top:2.5mm;padding-top:2.2mm;border-top:1px solid #000}.notes-value{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:1mm}.meta{font-size:.92em;line-height:1.45;overflow-wrap:anywhere}.customer-card{border:1px solid #000;padding:2mm 2.2mm;margin:2mm 0;break-inside:avoid}.customer-row{margin:.8mm 0;overflow-wrap:anywhere}.customer-label{font-weight:800}.product-observation{margin-top:1mm;font-size:.9em;white-space:pre-wrap;overflow-wrap:anywhere}.signature{margin-top:5mm;text-align:center;break-inside:avoid}.signature-line{border-top:1px solid #000;width:70%;margin:0 auto 1.2mm}
.closure-summary .summary-line{grid-template-columns:minmax(0,1fr) max-content;column-gap:2.5mm;padding:1.2mm 0}.closure-summary .summary-label{min-width:0;white-space:normal;overflow-wrap:anywhere}.closure-summary .summary-line>strong{display:block;text-align:right;white-space:nowrap}.closure-summary .section-label{margin-bottom:1mm}.closure-summary .payment-name{display:block;overflow-wrap:anywhere}
@media screen{body{width:${contentWidth}mm;margin:0 auto;box-shadow:0 0 0 1px #ddd}.receipt{min-height:100vh}}
@media print{html,body{margin:0!important;padding:0!important;width:${contentWidth}mm!important}.receipt{margin:0!important;width:${contentWidth}mm!important;max-width:${contentWidth}mm!important;padding:2.8mm 2.5mm 4mm!important;box-shadow:none!important}.no-print{display:none!important}a{color:#000;text-decoration:none}}
</style></head><body><main class="receipt">${body}</main><script>window.onload=()=>{setTimeout(()=>window.print(),180)};window.onafterprint=()=>window.close()</script></body></html>`
}

export function printSaleReceipt(sale: Sale, fontSize = 11, copyLabel = 'COPIA', paperWidth = 58) {
  const safeSize = safeFontSize(fontSize)
  const width = safePaperWidth(paperWidth)
  const popup = window.open('', '_blank', `width=${width === 58 ? 420 : 640},height=760`)
  if (!popup) return false
  const items = (sale.items || []).map(item => `<div class="item"><div class="row"><span class="item-name">${esc(item.quantity)}× ${esc(item.name)}</span><strong>${cop(item.total)}</strong></div><div class="small">${cop(item.unitPrice)} c/u</div>${item.modification ? `<div class="product-observation"><b>Observación del producto:</b> ${esc(item.modification)}</div>` : ''}</div>`).join('')
  const customerRows = [
    sale.customerName?.trim() ? `<div class="customer-row"><span class="customer-label">Cliente: </span>${esc(sale.customerName)}</div>` : '',
    sale.phone?.trim() ? `<div class="customer-row"><span class="customer-label">Teléfono: </span>${esc(sale.phone)}</div>` : '',
    sale.address?.trim() ? `<div class="customer-row"><span class="customer-label">Dirección: </span>${esc(sale.address)}</div>` : '',
    ...Object.entries(sale.customFields || {}).filter(([, value]) => String(value ?? '').trim()).map(([key, value]) => `<div class="customer-row"><span class="customer-label">${esc(sale.customFieldLabels?.[key] || key)}: </span>${esc(value)}</div>`),
  ].filter(Boolean).join('')
  const customerNotes = sale.notes?.trim() ? `<div class="notes"><div class="section-label">OBSERVACIONES DEL CLIENTE</div><div class="notes-value">${esc(sale.notes)}</div></div>` : ''
  const customerInfo = customerRows || customerNotes
    ? `<hr class="rule"><div class="section-label">DATOS DEL CLIENTE</div><div class="customer-card">${customerRows || '<div>Consumidor final</div>'}</div>${customerNotes}`
    : ''
  const body = `<div class="center"><div class="brand">Smaky Burgers</div><div class="title">FACTURA · ${esc(copyLabel)}</div><div class="muted">Pedido #${esc(sale.orderNumber ?? sale.id.slice(-6).toUpperCase())}</div></div><hr class="rule"><div class="meta">Fecha: ${esc(new Date(sale.createdAt).toLocaleString('es-CO'))}<br>Atendido por: ${esc(sale.userName)}</div>${customerInfo}<hr class="rule">${items}<hr class="rule"><div class="row"><span>Subtotal</span><strong>${cop(sale.subtotal)}</strong></div>${sale.discountAmount ? `<div class="row"><span>Descuento</span><strong>-${cop(sale.discountAmount)}</strong></div>` : ''}<div class="row total"><span>TOTAL</span><strong>${cop(sale.total)}</strong></div><div class="footer">Gracias por tu compra · Smaky POS</div>`
  popup.document.open()
  popup.document.write(baseHtml(`Factura ${sale.orderNumber ?? sale.id}`, safeSize, body, width))
  popup.document.close()
  return true
}

export function printOrderComanda(order: Order, fontSize = 11, paperWidth = 58) {
  const safeSize = safeFontSize(fontSize)
  const width = safePaperWidth(paperWidth)
  const popup = window.open('', '_blank', `width=${width === 58 ? 420 : 640},height=720`)
  if (!popup) return false
  const items = (order.items || []).map(item => `<div class="item"><div class="row"><span class="item-name">${esc(item.quantity)}× ${esc(item.name)}</span></div>${item.modification ? `<div class="product-observation"><b>Indicación:</b> ${esc(item.modification)}</div>` : ''}</div>`).join('')
  const body = `<div class="center"><div class="brand">COMANDA DE COCINA</div><div class="title">PEDIDO #${esc(order.orderNumber)}</div><div class="muted">${esc(new Date(order.createdAt).toLocaleString('es-CO'))}</div></div><hr class="rule"><div class="meta">Preparar: ${esc(order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))} unidades</div><hr class="rule">${items}<hr class="rule"><div class="footer">Smaky POS · Cocina</div>`
  popup.document.open()
  popup.document.write(baseHtml(`Comanda ${order.orderNumber}`, safeSize, body, width))
  popup.document.close()
  return true
}

export function printCashClosingReceipt(closure: CashClosure, fontSize = 11, paperWidth = 58) {
  const safeSize = safeFontSize(fontSize)
  const width = safePaperWidth(paperWidth)
  const popup = window.open('', '_blank', `width=${width === 58 ? 420 : 640},height=760`)
  if (!popup) return false

  const fallbackLabels: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta' }
  const payments = closure.payments && Object.keys(closure.payments).length ? closure.payments : { cash: closure.cash, transfer: closure.transfer, card: closure.card }
  const paymentRows = Object.entries(payments).map(([id, amount]) => {
    const numericAmount = Number(amount) || 0
    const count = Array.isArray(closure.sales) ? closure.sales.filter(sale => sale.payment === id && !sale.deletedAt).length : 0
    const fallbackFromSales = count > 0 ? (closure.sales.find(sale => sale.payment === id && sale.paymentLabel)?.paymentLabel || '') : ''
    return { id, label: closure.paymentLabels?.[id] || fallbackFromSales || fallbackLabels[id] || id, amount: numericAmount, count }
  }).filter(item => item.amount !== 0 || item.count > 0).sort((a, b) => {
    const order: Record<string, number> = { cash: 0, transfer: 1, card: 2 }
    return (order[a.id] ?? 10) - (order[b.id] ?? 10) || a.label.localeCompare(b.label, 'es')
  })
  const paymentHtml = paymentRows.length
    ? paymentRows.map(item => `<div class="summary-line"><span class="summary-label"><span class="payment-name">${esc(item.label)}</span>${item.count ? `<span class="summary-count">${item.count} ${item.count === 1 ? 'movimiento' : 'movimientos'}</span>` : ''}</span><strong>${cop(item.amount)}</strong></div>`).join('')
    : `<div class="summary-line"><span class="summary-label"><span class="payment-name">Sin movimientos</span></span><strong>${cop(0)}</strong></div>`
  const difference = Number(closure.cashDifference) || 0
  const differenceLabel = difference === 0 ? 'CUADRE EXACTO' : difference > 0 ? 'SOBRANTE' : 'FALTANTE'
  const nextDate = closure.nextDateKey ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' }).format(new Date(`${closure.nextDateKey}T12:00:00`)) : '—'
  const body = `<div class="center"><div class="brand">Smaky Burgers</div><div class="title">CIERRE DE CAJA</div></div><hr class="rule"><div class="meta"><b>Período:</b> ${esc(closure.dateKey)}<br><b>Cierre:</b> ${esc(new Date(closure.closedAt).toLocaleString('es-CO'))}<br><b>Responsable:</b> ${esc(closure.userName)}</div><hr class="rule"><div class="section-label">RESUMEN DEL PERÍODO</div><div class="summary-card closure-summary"><div class="summary-line"><span class="summary-label">Ventas registradas</span><strong>${esc(closure.saleCount)}</strong></div><div class="summary-line"><span class="summary-label">TOTAL VENTAS</span><strong>${cop(closure.total)}</strong></div></div><div class="summary-card closure-summary"><div class="section-label">MEDIOS DE PAGO</div>${paymentHtml}</div><div class="summary-card cash-check closure-summary"><div class="section-label">ARQUEO DE EFECTIVO</div><div class="summary-line"><span class="summary-label">Efectivo esperado</span><strong>${cop(closure.cashExpected)}</strong></div><div class="summary-line"><span class="summary-label">Efectivo contado</span><strong>${cop(closure.cashCounted)}</strong></div><div class="difference">${esc(differenceLabel)}<br>${cop(Math.abs(difference))}</div></div>${closure.notes ? `<div class="notes"><div class="section-label">OBSERVACIONES DEL CIERRE</div><div class="notes-value">${esc(closure.notes)}</div></div>` : ''}<hr class="rule"><div class="summary-card closure-summary"><div class="section-label">PERÍODO SIGUIENTE</div><div class="strong">${esc(closure.nextDateKey || '—')}</div><div class="small">${esc(nextDate)}</div></div><div class="signature"><div class="signature-line"></div><div class="small">Responsable del cierre</div></div><div class="footer">Smaky POS · Cierre interno de caja</div>`
  popup.document.open()
  popup.document.write(baseHtml(`Cierre de caja ${closure.dateKey}`, safeSize, body, width))
  popup.document.close()
  return true
}
