import type { CashClosure, Order, Sale, SaleItem } from './types'
import { money, date, time } from './format'

const escapeHtml = (value: string | number | undefined | null) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')

const buildPrintDocument = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=88mm,initial-scale=1,maximum-scale=1"><title>${escapeHtml(title)}</title><style>
  @page{size:88mm auto;margin:0}
  html,body{width:88mm;min-width:0;height:auto;min-height:0;margin:0;padding:0;background:#fff;color:#000;overflow:visible}
  *{box-sizing:border-box;color:#000!important}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.22;font-weight:500;print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .receipt{width:88mm;max-width:88mm;margin:0;padding:1.2mm 1.4mm 2.2mm;background:#fff;color:#000}
  .center{text-align:center}
  .brand{font-size:18px;font-weight:900;letter-spacing:1.7px;line-height:1.1}
  .subbrand{font-size:10px;font-weight:700;margin-top:2px}
  .doc-label{font-size:8.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;margin-top:4px}
  .order-no{font-size:16px;font-weight:900;margin-top:5px}
  .meta{font-size:8.5px;margin-top:3px;font-weight:600}
  .line{border-top:1px dashed #000;margin:7px 0}
  .item{display:flex;justify-content:space-between;align-items:flex-start;gap:7px;padding:3.5px 0;break-inside:avoid;page-break-inside:avoid}
  .item-main{min-width:0;flex:1}
  .item-name{font-size:10.5px;font-weight:800;line-height:1.2;overflow-wrap:anywhere}
  .item-sub{font-size:8.5px;font-weight:500;margin-top:2px;line-height:1.2;overflow-wrap:anywhere}
  .qty{font-weight:900;white-space:nowrap}
  .amount{font-size:10.5px;font-weight:900;white-space:nowrap;text-align:right}
  .section{font-size:9px;font-weight:900;letter-spacing:.8px;text-transform:uppercase;border-bottom:1px solid #000;padding:4px 0 3px;margin-top:3px;break-inside:avoid;page-break-inside:avoid}
  .totals{border-top:1px solid #000;margin-top:5px;padding-top:5px;break-inside:avoid;page-break-inside:avoid}
  .total-row{display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:10px}
  .total-row span{font-weight:700}
  .total-row b{font-weight:900}
  .total-row.grand{padding-top:5px}
  .total-row.grand span{font-size:12px;font-weight:900}
  .total-row.grand strong{font-size:18px;font-weight:900}
  .note{border:1px solid #000;padding:5px 6px;margin-top:6px;font-size:8.5px;line-height:1.25;break-inside:avoid;page-break-inside:avoid}
  .note b{font-size:8px;letter-spacing:.6px}
  .footer{text-align:center;border-top:1px dashed #000;margin-top:7px;padding-top:5px;font-size:8.5px;font-weight:700;line-height:1.2;break-inside:avoid;page-break-inside:avoid}
  @media print{
    html,body{width:88mm!important;min-width:0!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:visible!important}
    .receipt{width:88mm!important;max-width:none!important;margin:0!important;padding:1.2mm 1.4mm 2.2mm!important}
  }
</style></head><body>${body}</body></html>`

const printWindow = (title: string, body: string, _width = 390, target?: Window | null) => {
  const html = buildPrintDocument(title, body)
  let printHost: Window | null = target ?? null
  let frame: HTMLIFrameElement | null = null

  try {
    if (printHost) {
      printHost.document.open()
      printHost.document.write(`${html}<script>(() => {
        const doPrint = () => { try { window.focus(); window.print(); } catch {} }
        if (document.fonts?.ready) document.fonts.ready.then(() => setTimeout(doPrint, 60));
        else setTimeout(doPrint, 100);
        window.addEventListener('afterprint', () => setTimeout(() => { try { window.close() } catch {} }, 120), { once: true });
      })();<\/script>`)
      printHost.document.close()
      return true
    }

    frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.setAttribute('title', title)
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '88mm'
    frame.style.height = '1px'
    frame.style.border = '0'
    frame.style.opacity = '0'
    frame.style.pointerEvents = 'none'
    document.body.appendChild(frame)

    const doc = frame.contentDocument
    const printWin = frame.contentWindow
    if (!doc || !printWin) throw new Error('No se pudo crear el documento de impresión.')

    let printed = false
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      window.setTimeout(() => frame?.remove(), 80)
    }
    const doPrint = () => {
      if (printed || !frame?.isConnected) return
      printed = true
      try { printWin.focus(); printWin.print() } catch { cleanup() }
    }

    printWin.addEventListener('afterprint', cleanup, { once: true })
    doc.open()
    doc.write(html)
    doc.close()
    if (doc.fonts?.ready) doc.fonts.ready.then(() => window.setTimeout(doPrint, 60))
    else window.setTimeout(doPrint, 100)
    window.setTimeout(cleanup, 60000)
    return true
  } catch {
    if (frame) frame.remove()
    try { printHost?.close() } catch {}
    return false
  }
}

const categoryOrder = ['Combos', 'Hamburguesas', 'Acompañamientos', 'Bebidas']

const groupedItems = (items: SaleItem[]) => {
  const known = categoryOrder.map(category => ({ category, items: items.filter(item => (item.category || '') === category) })).filter(group => group.items.length)
  const knownNames = new Set(categoryOrder)
  const dynamic = Array.from(new Set(items.map(item => item.category || 'Producto').filter(category => !knownNames.has(category))))
    .map(category => ({ category, items: items.filter(item => (item.category || 'Producto') === category) }))
    .filter(group => group.items.length)
  return [...known, ...dynamic]
}

const commandItem = (item: SaleItem) => `<div class="item"><span class="qty">${item.quantity}×</span><div class="item-main"><div class="item-name">${escapeHtml(item.name)}</div><div class="item-sub">${escapeHtml(item.category || 'Producto')}</div>${item.modification ? `<div class="item-sub"><b>MOD:</b> ${escapeHtml(item.modification)}</div>` : ''}</div></div>`

export function printOrderComanda(order: Order, target?: Window | null) {
  const groups = groupedItems(order.items).map(group => `<div class="section">${escapeHtml(group.category)}</div>${group.items.map(commandItem).join('')}`).join('')
  return printWindow(`Comanda Pedido ${order.orderNumber}`, `
    <div class="receipt">
      <div class="center"><div class="brand">SMAKY</div><div class="subbrand">Comanda de cocina</div><div class="doc-label">Pedido</div><div class="order-no">#${escapeHtml(order.orderNumber)}</div><div class="meta">${escapeHtml(date(order.createdAt))} · ${escapeHtml(time(order.createdAt))} · ${escapeHtml(order.userName)}</div></div>
      <div class="line"></div>${groups}
      ${order.notes ? `<div class="note"><b>OBSERVACIONES</b><br>${escapeHtml(order.notes)}</div>` : ''}
      <div class="line"></div><div class="footer">Preparar pedido · verificar modificaciones</div>
    </div>`, 390, target)
}

export function printSaleReceipt(sale: Sale, target?: Window | null, documentLabel = 'ORIGINAL') {
  const items = sale.items.map(item => `<div class="item"><div class="item-main"><div><span class="qty">${item.quantity}×</span> <span class="item-name">${escapeHtml(item.name)}</span></div>${item.modification ? `<div class="item-sub">${escapeHtml(item.modification)}</div>` : `<div class="item-sub">${escapeHtml(item.category || 'Producto')}</div>`}</div><strong class="amount">${money(item.total)}</strong></div>`).join('')
  const payment = sale.paymentLabel || (sale.payment === 'cash' ? 'Efectivo' : sale.payment === 'transfer' ? 'Transferencia' : sale.payment === 'card' ? 'Tarjeta' : sale.payment)
  const discount = sale.discountAmount && sale.discountAmount > 0 ? `<div class="total-row"><span>Descuento${sale.discountType === 'percent' && sale.discountValue ? ` (${sale.discountValue}%)` : ''}</span><b>−${money(sale.discountAmount)}</b></div>` : ''
  return printWindow(`Comprobante #${sale.orderNumber ?? sale.id.slice(-6)}`, `
    <div class="receipt">
      <div class="center"><div class="brand">SMAKY</div><div class="doc-label">Factura / comprobante · ${escapeHtml(documentLabel)}</div><div class="order-no">Pedido #${escapeHtml(sale.orderNumber ?? sale.id.slice(-6).toUpperCase())}</div><div class="meta">Venta #${escapeHtml(sale.id.slice(-6).toUpperCase())} · ${escapeHtml(date(sale.createdAt))} · ${escapeHtml(time(sale.createdAt))}</div></div>
      <div class="line"></div>
      <div class="item"><div class="item-main"><div class="item-name">Cliente</div><div class="item-sub">${escapeHtml(sale.customerName || 'Consumidor final')}</div></div><div class="item-main" style="text-align:right"><div class="item-name">Pago</div><div class="item-sub">${escapeHtml(payment)}</div></div></div>
      <div class="line"></div>
      ${items}
      <div class="totals"><div class="total-row"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div>${discount}<div class="total-row grand"><span>Total</span><strong>${money(sale.total)}</strong></div></div>
      ${sale.notes ? `<div class="note"><b>OBSERVACIONES</b><br>${escapeHtml(sale.notes)}</div>` : ''}
      <div class="footer">Gracias por tu compra · Smaky POS</div>
    </div>`, 390, target)
}

export function printCashClosure(closure: CashClosure, target?: Window | null) {
  const invoices = closure.sales.map(sale => `<div class="item"><div class="item-main"><div class="item-name">#${escapeHtml(sale.orderNumber ?? sale.id.slice(-6).toUpperCase())}</div><div class="item-sub">${escapeHtml(sale.customerName || 'Consumidor final')} · ${escapeHtml(paymentLabelForPrint(sale.payment, sale.paymentLabel))}</div></div><strong class="amount">${money(sale.total)}</strong></div>`).join('')
  const difference = closure.cashDifference === 0 ? '$0' : `${closure.cashDifference > 0 ? '+' : ''}${money(closure.cashDifference)}`
  return printWindow(`Cierre ${closure.dateKey}`, `
    <div class="receipt">
      <div class="center"><div class="brand">SMAKY</div><div class="doc-label">Resumen de cierre de caja</div><div class="order-no">${escapeHtml(closure.dateKey.split('-').reverse().join('/'))}</div><div class="meta">Cerrado por ${escapeHtml(closure.userName)} · ${escapeHtml(time(closure.closedAt))}</div></div>
      <div class="line"></div>
      <div class="section">Resumen</div>
      ${Object.entries(closure.payments || { cash: closure.cash, transfer: closure.transfer, card: closure.card }).map(([id, amount]) => `<div class="item"><div class="item-main"><div class="item-name">${escapeHtml(closure.paymentLabels?.[id] || paymentLabelForPrint(id))}</div></div><strong class="amount">${money(Number(amount))}</strong></div>`).join('')}
      <div class="item"><div class="item-main"><div class="item-name">Efectivo esperado</div></div><strong class="amount">${money(closure.cashExpected)}</strong></div>
      <div class="item"><div class="item-main"><div class="item-name">Efectivo contado</div></div><strong class="amount">${money(closure.cashCounted)}</strong></div>
      <div class="item"><div class="item-main"><div class="item-name">Diferencia</div></div><strong class="amount">${difference}</strong></div>
      <div class="totals"><div class="total-row grand"><span>Total del cierre</span><strong>${money(closure.total)}</strong></div></div>
      ${closure.notes ? `<div class="note"><b>OBSERVACIÓN</b><br>${escapeHtml(closure.notes)}</div>` : ''}
      <div class="line"></div><div class="section">Facturas del cierre</div>${invoices || '<div class="item"><span>Sin ventas registradas.</span></div>'}
      <div class="footer">Smaky POS · Próximo periodo ${escapeHtml(closure.nextDateKey.split('-').reverse().join('/'))}</div>
    </div>`, 390, target)
}

const paymentLabelForPrint = (payment: Sale['payment'], label?: string) => label || (payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : payment === 'card' ? 'Tarjeta' : payment)
