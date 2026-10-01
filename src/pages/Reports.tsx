import { BarChart3, Banknote, CalendarDays, ChevronDown, CreditCard, Download, FileJson, FileSpreadsheet, FileText, Printer, ReceiptText, ShoppingBag, TrendingUp, Utensils, WalletCards, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getAllProducts, getSales, recordBusinessDayKey } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { PaymentMethod, Product, Sale } from '../lib/types'

const paymentLabel = (payment: PaymentMethod) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : 'Tarjeta'
const paymentIcon = (payment: PaymentMethod) => payment === 'cash' ? Banknote : payment === 'transfer' ? WalletCards : CreditCard
const pad = (value: number) => String(value).padStart(2, '0')
const keyFromDate = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
const dateFromKey = (value: string) => { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day) }
const shiftDays = (value: string, amount: number) => { const date = dateFromKey(value); date.setDate(date.getDate() + amount); return keyFromDate(date) }
const daysBetween = (from: string, to: string) => { const days: string[] = []; for (let cursor = from; cursor <= to; cursor = shiftDays(cursor, 1)) days.push(cursor); return days }
const dayLabel = (value: string) => new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit' }).format(dateFromKey(value)).replace('.', '')
const dateLabel = (value: string) => new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(dateFromKey(value)).replace('.', '')
const defaultRange = () => { const today = keyFromDate(new Date()); return { from: shiftDays(today, -29), to: today } }

export function Reports() {
  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const initial = defaultRange()
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [range, setRange] = useState('30')
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

  useEffect(() => { Promise.all([getSales(), getAllProducts()]).then(([salesData, productData]) => { setSales(salesData); setProducts(productData) }) }, [])

  const burgerIds = useMemo(() => new Set(products.filter(product => product.category === 'Hamburguesas').map(product => product.id)), [products])
  const burgerEquivalent = (productId: string, productName: string, quantity: number) => {
    if (burgerIds.has(productId)) return quantity
    const comboMatch = /\bcombo\s*([1-4])\b/i.exec(productName)
    return comboMatch ? quantity * Number(comboMatch[1]) : 0
  }
  const filteredSales = useMemo(() => sales.filter(sale => { const key = recordBusinessDayKey(sale); return key >= dateFrom && key <= dateTo }), [sales, dateFrom, dateTo])
  const days = useMemo(() => daysBetween(dateFrom, dateTo), [dateFrom, dateTo])

  const report = useMemo(() => {
    const daily = new Map<string, { revenue: number; tickets: number; units: number; burgers: number }>()
    days.forEach(day => daily.set(day, { revenue: 0, tickets: 0, units: 0, burgers: 0 }))
    const productMap = new Map<string, { name: string; units: number; revenue: number }>()
    const payments = new Map<PaymentMethod, number>([['cash', 0], ['transfer', 0], ['card', 0]])
    let revenue = 0, units = 0, burgers = 0

    filteredSales.forEach(sale => {
      const day = daily.get(keyFromDate(new Date(sale.createdAt)))
      if (day) { day.revenue += sale.total; day.tickets += 1 }
      revenue += sale.total
      payments.set(sale.payment, (payments.get(sale.payment) || 0) + sale.total)
      sale.items.forEach(item => {
        units += item.quantity
        burgers += burgerEquivalent(item.productId, item.name, item.quantity)
        const current = productMap.get(item.productId) || { name: item.name, units: 0, revenue: 0 }
        current.units += item.quantity
        current.revenue += item.total
        productMap.set(item.productId, current)
        if (day) { day.units += item.quantity; day.burgers += burgerEquivalent(item.productId, item.name, item.quantity) }
      })
    })

    const dailyRows = days.map(day => ({ day, ...daily.get(day)! }))
    const maxBurgers = Math.max(1, ...dailyRows.map(row => row.burgers))
    const topDays = dailyRows.filter(row => row.burgers || row.revenue).sort((a, b) => b.burgers - a.burgers || b.revenue - a.revenue).slice(0, 5)
    const topProducts = [...productMap.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, 6)
    return { revenue, units, burgers, tickets: filteredSales.length, average: filteredSales.length ? revenue / filteredSales.length : 0, dailyRows, maxBurgers, topDays, topProducts, payments: [...payments.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]) }
  }, [filteredSales, days, burgerIds])

  useEffect(() => {
    if (selectedDay && !report.dailyRows.some(row => row.day === selectedDay)) setSelectedDay(null)
  }, [report.dailyRows, selectedDay])

  const selectedDayDetail = useMemo(() => {
    if (!selectedDay) return null
    const info = report.dailyRows.find(row => row.day === selectedDay)
    if (!info) return null
    const daySales = filteredSales.filter(sale => keyFromDate(new Date(sale.createdAt)) === selectedDay)
    const productMap = new Map<string, { name: string; units: number; burgers: number; revenue: number }>()
    const paymentMap = new Map<PaymentMethod, number>([['cash', 0], ['transfer', 0], ['card', 0]])
    daySales.forEach(sale => {
      paymentMap.set(sale.payment, (paymentMap.get(sale.payment) || 0) + sale.total)
      sale.items.forEach(item => {
        const burgers = burgerEquivalent(item.productId, item.name, item.quantity)
        const current = productMap.get(item.productId) || { name: item.name, units: 0, burgers: 0, revenue: 0 }
        current.units += item.quantity
        current.burgers += burgers
        current.revenue += item.total
        productMap.set(item.productId, current)
      })
    })
    return { ...info, sales: daySales, products: [...productMap.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue), payments: [...paymentMap.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]) }
  }, [selectedDay, filteredSales, report.dailyRows, burgerIds])

  const applyRange = (value: string) => {
    setRange(value)
    if (value === 'custom') return
    const today = keyFromDate(new Date())
    setDateTo(today)
    setDateFrom(shiftDays(today, -(Number(value) - 1)))
  }

  const exportReport = (kind: 'csv' | 'json') => {
    const rows = report.dailyRows.map(row => ({ fecha: row.day, ventas: row.tickets, unidades: row.units, hamburguesas: row.burgers, facturacion: row.revenue }))
    const payload = kind === 'csv'
      ? '\ufefffecha,ventas,unidades,hamburguesas,facturacion\n' + rows.map(row => `${row.fecha},${row.ventas},${row.unidades},${row.hamburguesas},${row.facturacion}`).join('\n')
      : JSON.stringify({ rango: { desde: dateFrom, hasta: dateTo }, resumen: { ventas: report.tickets, facturacion: report.revenue, unidades: report.units, hamburguesas: report.burgers, ticketPromedio: report.average }, dias: rows, productos: report.topProducts, ventas: filteredSales }, null, 2)
    const blob = new Blob([payload], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `smaky-reporte-${dateFrom}-${dateTo}.${kind}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  return <div className="report-page" onClick={() => exportOpen && setExportOpen(false)}>
    <div className="page-heading compact report-heading">
      <div><p className="eyebrow">INTELIGENCIA DEL NEGOCIO</p><h1>Reportes</h1><p className="muted">Mira qué días venden más, cuántas hamburguesas salen y cuánto factura el negocio.</p></div>
      <div className="report-actions">
        <div className="export-wrap" onClick={event => event.stopPropagation()}>
          <button className="report-export-btn" onClick={() => setExportOpen(value => !value)}><Download size={16}/> Exportar <ChevronDown size={14}/></button>
          {exportOpen && <div className="export-menu">
            <button onClick={() => exportReport('csv')}><FileSpreadsheet size={15}/><span><b>CSV de reporte</b><small>Abre en Excel / Sheets</small></span></button>
            <button onClick={() => exportReport('json')}><FileJson size={15}/><span><b>JSON completo</b><small>Resumen + detalle del periodo</small></span></button>
            <button onClick={() => { setExportOpen(false); window.print() }}><Printer size={15}/><span><b>Imprimir</b><small>Vista del reporte actual</small></span></button>
          </div>}
        </div>
      </div>
    </div>

    <div className={`report-filter panel ${range === 'custom' ? 'custom-range' : ''}`}>
      <div className="report-filter-top"><div><span className="filter-kicker"><CalendarDays size={14}/> PERIODO DEL REPORTE</span><b>{dateLabel(dateFrom)} — {dateLabel(dateTo)}</b></div><span className="report-live"><span className="dot online"></span>{report.tickets} {report.tickets === 1 ? 'venta' : 'ventas'} encontradas</span></div>
      <div className="range-row">
        {['7', '30', '90', 'custom'].map(value => <button key={value} className={range === value ? 'range-btn active' : 'range-btn'} onClick={() => applyRange(value)}>{value === 'custom' ? 'Personalizado' : `${value} días`}</button>)}
      </div>
      <div className="date-inputs">
        <label>Desde<input type="date" value={dateFrom} onChange={event => { setRange('custom'); const next = event.target.value; setDateFrom(next); if (next > dateTo) setDateTo(next) }} /></label>
        <span>→</span>
        <label>Hasta<input type="date" value={dateTo} min={dateFrom} onChange={event => { setRange('custom'); setDateTo(event.target.value) }} /></label>
      </div>
    </div>

    <div className="stats-grid report-stats">
      <div className="stat-card report-stat"><div className="stat-head"><span>Facturación</span><div className="stat-icon"><TrendingUp size={15}/></div></div><strong>{money(report.revenue)}</strong><small>En el periodo seleccionado</small></div>
      <div className="stat-card report-stat"><div className="stat-head"><span>Hamburguesas</span><div className="stat-icon"><Utensils size={15}/></div></div><strong>{report.burgers}</strong><small>Hamburguesas reales (incluye combos)</small></div>
      <div className="stat-card report-stat"><div className="stat-head"><span>Ventas</span><div className="stat-icon"><ReceiptText size={15}/></div></div><strong>{report.tickets}</strong><small>Tickets registrados</small></div>
      <div className="stat-card report-stat"><div className="stat-head"><span>Ticket promedio</span><div className="stat-icon"><ShoppingBag size={15}/></div></div><strong>{money(report.average)}</strong><small>Facturación ÷ ventas</small></div>
    </div>

    <div className="report-main-grid">
      <div className="panel report-chart-panel">
        <div className="panel-title"><div><h2>Hamburguesas vendidas por día</h2><p>Combo 1 = 1 · Combo 2 = 2 · Combo 3 = 3 · Combo 4 = 4 hamburguesas.</p></div><span className="report-unit">UNIDADES</span></div>
        {report.tickets === 0 ? <div className="report-empty"><BarChart3 size={30}/><b>No hay ventas en este rango</b><span>Amplía las fechas o registra una venta para llenar el gráfico.</span></div> : <div className="report-chart-area"><div className="report-chart-gridlines"><i></i><i></i><i></i><i></i></div><div className="report-bars" style={{ gridTemplateColumns: `repeat(${report.dailyRows.length}, minmax(0, 1fr))` }}>{report.dailyRows.map((row, index) => <button className={`report-bar-col ${selectedDay === row.day ? 'selected' : ''}`} key={row.day} title={`${dateLabel(row.day)} · ${row.burgers} hamburguesas · ${money(row.revenue)}`} onClick={() => setSelectedDay(row.day)}><span className="report-bar-value">{row.burgers || ''}</span><div className="report-bar-track"><div className="report-bar-fill" style={{ height: row.burgers ? `${row.burgers / report.maxBurgers * 100}%` : '0%' }} /></div><small>{report.dailyRows.length <= 14 || index % Math.max(1, Math.ceil(report.dailyRows.length / 8)) === 0 ? dayLabel(row.day) : index === report.dailyRows.length - 1 ? dayLabel(row.day) : ''}</small></button>)}</div></div>}
        <div className="report-chart-foot"><span><i className="legend-dot"></i> Hamburguesas</span><b>{report.burgers} en total</b></div>
      </div>

      <div className="panel report-topdays-panel">
        <div className="panel-title"><div><h2>Días con más movimiento</h2><p>Ordenados por hamburguesas vendidas.</p></div></div>
        {report.topDays.length === 0 ? <div className="report-empty compact"><CalendarDays size={28}/><b>Aún no hay días para comparar</b></div> : <div className="top-days-list">{report.topDays.map((row, index) => <button className={`top-day-row ${selectedDay === row.day ? 'selected' : ''}`} key={row.day} onClick={() => setSelectedDay(row.day)}><span className="top-day-rank">0{index + 1}</span><div className="top-day-main"><b>{new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: 'short' }).format(dateFromKey(row.day)).replace('.', '')}</b><small>{row.tickets} {row.tickets === 1 ? 'venta' : 'ventas'} · {money(row.revenue)}</small><div className="top-day-bar"><span style={{ width: `${row.burgers / report.maxBurgers * 100}%` }} /></div></div><strong>{row.burgers}</strong><span className="top-day-arrow">›</span></button>)}</div>}
      </div>
    </div>

    {selectedDayDetail && <div className="panel report-day-detail">
      <div className="report-day-detail-head">
        <div><span className="filter-kicker"><CalendarDays size={14}/> DETALLE DEL DÍA</span><h2>{new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(dateFromKey(selectedDayDetail.day)).replace('.', '')}</h2><p>{selectedDayDetail.tickets} {selectedDayDetail.tickets === 1 ? 'ticket registrado' : 'tickets registrados'} · {selectedDayDetail.burgers} hamburguesas equivalentes vendidas</p></div>
        <button className="report-day-close" onClick={() => setSelectedDay(null)}>Cerrar</button>
      </div>
      <div className="report-day-kpis">
        <div><small>Facturación</small><strong>{money(selectedDayDetail.revenue)}</strong></div>
        <div><small>Hamburguesas</small><strong>{selectedDayDetail.burgers}</strong></div>
        <div><small>Productos</small><strong>{selectedDayDetail.units}</strong></div>
        <div><small>Ticket promedio</small><strong>{money(selectedDayDetail.tickets ? selectedDayDetail.revenue / selectedDayDetail.tickets : 0)}</strong></div>
      </div>
      <div className="report-day-columns">
        <div className="report-day-section"><div className="panel-title"><div><h3>Productos del día</h3><p>Incluye equivalencia de hamburguesas.</p></div></div>{selectedDayDetail.products.length === 0 ? <div className="report-empty compact"><ShoppingBag size={26}/><b>No hay productos</b></div> : <div className="day-product-list">{selectedDayDetail.products.map(product => <div className="day-product-row" key={product.name}><div><b>{product.name}</b><small>{product.units} unidades · {product.burgers} hamburguesas</small></div><strong>{money(product.revenue)}</strong></div>)}</div>}</div>
        <div className="report-day-section"><div className="panel-title"><div><h3>Medios de pago</h3><p>Recaudo del día.</p></div></div>{selectedDayDetail.payments.length === 0 ? <div className="report-empty compact"><CreditCard size={26}/><b>No hay pagos</b></div> : <div className="day-payment-list">{selectedDayDetail.payments.map(([payment, amount]) => { const Icon = paymentIcon(payment); return <div className="day-payment-row" key={payment}><span className="payment-report-icon"><Icon size={15}/></span><div><b>{paymentLabel(payment)}</b><small>{money(amount)}</small></div><strong>{selectedDayDetail.revenue ? Math.round(amount / selectedDayDetail.revenue * 100) : 0}%</strong></div> })}</div>}</div>
      </div>
      <div className="report-day-sales"><div className="day-sales-head"><div className="panel-title"><div><span className="filter-kicker"><FileText size={13}/> DOCUMENTOS DEL DÍA</span><h3>Facturas del día</h3><p>Toca una factura para ver el comprobante completo, igual que en Ventas.</p></div></div><span className="invoice-count">{selectedDayDetail.sales.length} {selectedDayDetail.sales.length === 1 ? 'factura' : 'facturas'}</span></div>{selectedDayDetail.sales.length === 0 ? <div className="report-empty compact"><ReceiptText size={26}/><b>No hay facturas</b></div> : <div className="day-sales-list">{selectedDayDetail.sales.map(sale => <button className="day-sale-row" key={sale.id} onClick={() => setSelectedSale(sale)}><div className="day-sale-time">{time(sale.createdAt)}</div><div className="day-sale-main"><b>Factura #{sale.id.slice(-6).toUpperCase()}</b><small>{sale.items.map(item => `${item.quantity}× ${item.name}`).join(' · ')}</small></div><div className="day-sale-user"><span>Atendió</span><b>{sale.userName}</b></div><span className="day-sale-payment">{paymentLabel(sale.payment)}</span><strong>{money(sale.total)}</strong><span className="day-sale-arrow">›</span></button>)}</div>}</div>
    </div>}


    {selectedSale && <div className="modal-backdrop receipt-backdrop" onClick={() => setSelectedSale(null)}>
      <div className="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="report-receipt-title" onClick={event => event.stopPropagation()}>
        <button className="receipt-close" onClick={() => setSelectedSale(null)} aria-label="Cerrar"><X size={18}/></button>
        <div className="receipt-top">
          <div className="receipt-brand-mark">S</div>
          <p className="eyebrow">COMPROBANTE</p>
          <h2 id="report-receipt-title">Smaky Burgers</h2>
          <span>Factura #{selectedSale.id.slice(-6).toUpperCase()}</span>
        </div>
        <div className="receipt-meta">
          <div><span>Fecha</span><b>{date(selectedSale.createdAt)} · {time(selectedSale.createdAt)}</b></div>
          <div><span>Atendido por</span><b>{selectedSale.userName}</b></div>
          <div><span>Pago</span><b>{paymentLabel(selectedSale.payment)}</b></div>
        </div>
        <div className="receipt-section-title">Productos</div>
        <div className="receipt-items">{selectedSale.items.map(item => <div className="receipt-item" key={item.productId}>
          <div><b>{item.quantity}× {item.name}</b><span>{money(item.unitPrice)} c/u</span></div>
          <strong>{money(item.total)}</strong>
        </div>)}</div>
        <div className="receipt-total">
          <div><span>Subtotal</span><b>{money(selectedSale.subtotal)}</b></div>
          <div className="grand"><span>Total</span><strong>{money(selectedSale.total)}</strong></div>
        </div>
        <div className="receipt-footer">Gracias por tu compra · Smaky POS</div>
      </div>
    </div>}

    <div className="report-bottom-grid">
      <div className="panel">
        <div className="panel-title"><div><h2>Productos más vendidos</h2><p>Unidades y facturación del periodo.</p></div></div>
        {report.topProducts.length === 0 ? <div className="report-empty compact"><ShoppingBag size={28}/><b>No hay productos para mostrar</b></div> : <div className="product-report-list">{report.topProducts.map((product, index) => <div className="product-report-row" key={product.name}><span className="product-report-rank">{String(index + 1).padStart(2, '0')}</span><div><b>{product.name}</b><small>{product.units} unidades · {money(product.revenue)}</small></div><strong>{Math.round(product.units / report.units * 100) || 0}%</strong></div>)}</div>}
      </div>

      <div className="panel">
        <div className="panel-title"><div><h2>Medios de pago</h2><p>Cómo se está cobrando.</p></div></div>
        {report.payments.length === 0 ? <div className="report-empty compact"><CreditCard size={28}/><b>No hay pagos para mostrar</b></div> : <div className="payment-report-list">{report.payments.map(([payment, amount]) => { const Icon = paymentIcon(payment); return <div className="payment-report-row" key={payment}><span className="payment-report-icon"><Icon size={15}/></span><div><b>{paymentLabel(payment)}</b><small>{money(amount)}</small></div><strong>{Math.round(amount / report.revenue * 100)}%</strong></div> })}</div>}
      </div>
    </div>
  </div>
}
