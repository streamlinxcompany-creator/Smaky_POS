import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, ChevronRight, FileText, LockKeyhole, ReceiptText, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { getSessionUser } from '../lib/auth'
import { addBusinessDay, businessDayKey, createDailyClosure, getClosureByDate, getClosures, getOrders, getSales } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { CashClosure, Order, Sale } from '../lib/types'
import { printSaleReceipt } from '../lib/print'

const paymentLabel = (payment: Sale['payment']) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : 'Tarjeta'
const displayDay = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date(Date.UTC(year, month - 1, day, 12))).replace('.', '')
}
const shortDay = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date(Date.UTC(year, month - 1, day, 12))).replace('.', '')
}

export function CashClosing() {
  const user = getSessionUser()
  const [sales, setSales] = useState<Sale[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [closures, setClosures] = useState<CashClosure[]>([])
  const [loading, setLoading] = useState(true)
  const [closeOpen, setCloseOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState<CashClosure | null>(null)
  const [cashCounted, setCashCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const progressRef = useRef(0)
  const draggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartProgressRef = useRef(0)
  const todayKey = businessDayKey(new Date())

  const load = async () => {
    setLoading(true)
    const [salesData, ordersData, closureData] = await Promise.all([getSales(), getOrders(), getClosures()])
    setSales(salesData)
    setOrders(ordersData)
    setClosures(closureData)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const todaySales = useMemo(() => sales.filter(sale => businessDayKey(sale.createdAt) === todayKey), [sales, todayKey])
  const openOrders = useMemo(() => orders.filter(order => businessDayKey(order.createdAt) === todayKey && !['paid', 'cancelled'].includes(order.status)), [orders, todayKey])
  const todayClosure = useMemo(() => closures.find(closure => closure.dateKey === todayKey) ?? null, [closures, todayKey])
  const todaySummary = useMemo(() => todaySales.reduce((acc, sale) => {
    acc.total += sale.total
    if (sale.payment === 'cash') acc.cash += sale.total
    else if (sale.payment === 'transfer') acc.transfer += sale.total
    else acc.card += sale.total
    return acc
  }, { total: 0, cash: 0, transfer: 0, card: 0 }), [todaySales])
  const counted = Number(cashCounted || 0)
  const difference = counted - todaySummary.cash
  const nextKey = todayClosure?.nextDateKey ?? addBusinessDay(todayKey, 1)
  const canClose = !!user && ['manager', 'admin'].includes(user.role) && !todayClosure && openOrders.length === 0 && Number.isFinite(counted) && counted >= 0 && !saving

  const resetSlider = () => { draggingRef.current = false; progressRef.current = 0; setProgress(0) }
  const openCloseModal = () => {
    setCashCounted(todaySummary.cash.toFixed(0))
    setNotes('')
    setError('')
    resetSlider()
    setCloseOpen(true)
  }
  const closeModal = () => { if (!saving) { setCloseOpen(false); resetSlider(); setError('') } }

  const startSlide = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canClose) return
    draggingRef.current = true
    dragStartXRef.current = event.clientX
    dragStartProgressRef.current = progressRef.current
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveSlide = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const travel = Math.max(1, bounds.width - 60)
    const delta = ((event.clientX - dragStartXRef.current) / travel) * 100
    const next = Math.max(0, Math.min(100, dragStartProgressRef.current + delta))
    progressRef.current = next
    setProgress(next)
  }
  const finishSlide = (event?: PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (event) { try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {} }
    if (progressRef.current >= 96) void confirmClose()
    else { progressRef.current = 0; setProgress(0) }
  }

  const confirmClose = async () => {
    if (!user || !canClose || progressRef.current < 96) return
    setSaving(true); setError('')
    try {
      const closure = await createDailyClosure(todayKey, user, Number(cashCounted), notes)
      if (!closure) throw new Error('No tienes permisos para realizar el cierre.')
      setCloseOpen(false); resetSlider(); setMessage(`Cierre del ${shortDay(todayKey)} realizado`)
      await load()
    } catch (caught) {
      resetSlider()
      setError(caught instanceof Error ? caught.message : 'No fue posible cerrar la caja.')
    } finally { setSaving(false) }
  }

  const printInvoice = (sale: Sale) => {
    const target = window.open('', '_blank', 'width=460,height=760')
    printSaleReceipt(sale, target)
  }

  if (!user) return null
  if (user.role === 'employee') return <div className="admin-guard panel"><ShieldCheck size={22}/><h2>Acceso administrativo</h2><p>El cierre de caja y su historial están disponibles para Administrador y Gerente.</p></div>

  if (loading) return <div className="closing-loading">Cargando control de caja…</div>

  return <div className="cash-closing-page">
    <div className="page-heading compact cash-closing-heading">
      <div><p className="eyebrow">CONTROL ADMINISTRATIVO</p><h1>Cierre de caja</h1><p className="muted">Registra el cierre del día, verifica el efectivo y conserva el detalle de las facturas asociadas.</p></div>
      <div className={`closing-status-pill ${todayClosure ? 'closed' : openOrders.length ? 'blocked' : 'pending'}`}>
        {todayClosure ? <CheckCircle2 size={15}/> : openOrders.length ? <AlertTriangle size={15}/> : <LockKeyhole size={15}/>} 
        {todayClosure ? 'Día cerrado' : openOrders.length ? `${openOrders.length} pedido${openOrders.length === 1 ? '' : 's'} pendiente${openOrders.length === 1 ? '' : 's'}` : 'Cierre pendiente'}
      </div>
    </div>

    <div className="closing-grid-top">
      <section className="panel closing-main-card">
        <div className="closing-main-top"><div><span className="filter-kicker"><LockKeyhole size={14}/> CIERRE DEL DÍA</span><h2>{displayDay(todayKey)}</h2><p>{todayClosure ? `Cerrado el ${date(todayClosure.closedAt)} · ${time(todayClosure.closedAt)} por ${todayClosure.userName}` : 'Todas las ventas de hoy se incluirán en este cierre.'}</p></div><div className={`closing-state ${todayClosure ? 'done' : 'open'}`}>{todayClosure ? 'CERRADO' : 'PENDIENTE'}</div></div>
        {todayClosure ? <div className="closing-closed-banner"><CheckCircle2 size={19}/><div><b>El día ya fue cerrado</b><span>El próximo cierre se calculará para el <strong>{shortDay(todayClosure.nextDateKey)}</strong>.</span></div><button className="secondary" onClick={() => setDetailOpen(todayClosure)}><FileText size={15}/> Ver facturas</button></div>
          : <>
            {openOrders.length > 0 && <div className="closing-warning"><AlertTriangle size={18}/><div><b>No puedes cerrar todavía</b><span>Hay {openOrders.length} pedido{openOrders.length === 1 ? '' : 's'} abierto{openOrders.length === 1 ? '' : 's'}. Cobra o resuelve los pedidos antes de cerrar el día.</span></div></div>}
            <div className="closing-stats"><div><span>Ventas</span><strong>{todaySales.length}</strong></div><div><span>Total vendido</span><strong>{money(todaySummary.total)}</strong></div><div><span>Efectivo</span><strong>{money(todaySummary.cash)}</strong></div><div><span>Transferencias</span><strong>{money(todaySummary.transfer)}</strong></div><div><span>Tarjetas</span><strong>{money(todaySummary.card)}</strong></div></div>
            <div className="closing-action-card"><div><span>EFECTIVO A VERIFICAR</span><b>{money(todaySummary.cash)}</b><small>El sistema espera este monto según las ventas en efectivo del día.</small></div><button className="primary" disabled={!!openOrders.length} onClick={openCloseModal}><LockKeyhole size={16}/> Preparar cierre</button></div>
          </>}
      </section>

      <section className="panel closing-next-card">
        <div className="panel-title"><div><h2>Qué pasa después</h2><p>Continuidad automática del cierre diario.</p></div><RotateCcw size={17}/></div>
        <div className="next-close-date"><span>PRÓXIMO PERIODO</span><strong>{shortDay(nextKey)}</strong><small>Una vez cerrado el {shortDay(todayKey)}, las nuevas ventas quedarán asociadas al siguiente día.</small></div>
        <div className="next-close-note"><ShieldCheck size={15}/><span>El cierre guarda el resumen y una copia del detalle de las facturas del día para consulta administrativa.</span></div>
      </section>
    </div>

    <section className="panel closure-history-panel">
      <div className="panel-title"><div><h2>Historial de cierres</h2><p>Cada día cerrado conserva su resumen y sus facturas.</p></div><span className="closure-history-count">{closures.length} cierres</span></div>
      {!closures.length ? <div className="closing-empty"><ReceiptText size={25}/><b>Aún no hay cierres registrados</b><span>El primer cierre aparecerá aquí cuando cierres el día.</span></div> : <div className="closure-history-list">{closures.map(closure => <article className="closure-history-row" key={closure.id}><div className="closure-history-icon"><ReceiptText size={17}/></div><div className="closure-history-main"><b>{shortDay(closure.dateKey)}</b><span>{closure.saleCount} {closure.saleCount === 1 ? 'factura' : 'facturas'} · Cerrado por {closure.userName} a las {time(closure.closedAt)}</span></div><div className="closure-history-total"><small>Total vendido</small><strong>{money(closure.total)}</strong></div><div className={`closure-difference ${closure.cashDifference === 0 ? 'ok' : closure.cashDifference > 0 ? 'surplus' : 'shortage'}`}>{closure.cashDifference === 0 ? 'Caja cuadrada' : `${closure.cashDifference > 0 ? '+' : ''}${money(closure.cashDifference)}`}</div><button className="secondary closure-view-btn" onClick={() => setDetailOpen(closure)}><FileText size={14}/> Ver cierre <ChevronRight size={14}/></button></article>)}</div>}
    </section>

    {message && <div className="closing-toast"><CheckCircle2 size={16}/>{message}</div>}

    {closeOpen && <div className="modal-backdrop closing-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeModal() }}>
      <section className="item-editor-modal closing-modal" role="dialog" aria-modal="true" aria-labelledby="closing-title">
        <header className="item-editor-head"><div><span className="item-editor-kicker">CONFIRMAR CIERRE</span><h3 id="closing-title">Cerrar caja del {shortDay(todayKey)}</h3><p>Revisa el resumen y confirma cuánto efectivo hay físicamente en caja.</p></div><button className="item-editor-close" disabled={saving} onClick={closeModal}><X size={18}/></button></header>
        <div className="item-editor-body closing-modal-body">
          <div className="closing-modal-summary"><div><span>Ventas</span><b>{todaySales.length}</b></div><div><span>Total vendido</span><b>{money(todaySummary.total)}</b></div><div><span>Efectivo esperado</span><b>{money(todaySummary.cash)}</b></div></div>
          <div className="closing-method-grid"><div><span>Efectivo</span><strong>{money(todaySummary.cash)}</strong></div><div><span>Transferencias</span><strong>{money(todaySummary.transfer)}</strong></div><div><span>Tarjetas</span><strong>{money(todaySummary.card)}</strong></div></div>
          <label className="closing-cash-input"><span>EFECTIVO CONTADO</span><input inputMode="numeric" value={cashCounted} onChange={event => setCashCounted(event.target.value.replace(/[^\d]/g, ''))} placeholder="0"/><small>El efectivo contado se compara con el monto esperado.</small></label>
          <div className={`cash-difference-box ${difference === 0 ? 'ok' : difference > 0 ? 'surplus' : 'shortage'}`}><div>{difference === 0 ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span>{difference === 0 ? 'Caja cuadrada' : difference > 0 ? 'Hay un excedente' : 'Hay un faltante'}</span></div><strong>{difference === 0 ? '$0' : `${difference > 0 ? '+' : ''}${money(difference)}`}</strong></div>
          <label className="closing-note-input"><span>OBSERVACIÓN <em>OPCIONAL</em></span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ej. Se retiraron $50.000 para compra de insumos…" /></label>
          <div className="closing-confirm-warning"><AlertTriangle size={15}/><span>Al cerrar <strong>{shortDay(todayKey)}</strong>, este día quedará bloqueado como cierre histórico y el siguiente periodo será <strong>{shortDay(nextKey)}</strong>.</span></div>
          <div className={`closing-slider ${progress >= 96 ? 'ready' : ''}`}><div className="closing-slider-fill" style={{ width: `${progress}%` }}/><span>Desliza para cerrar el día</span><button type="button" disabled={!canClose} className="closing-slider-thumb" style={{ left: `calc(${8 + (Math.min(100, Math.max(0, progress)) * 0.84)}% - 24px)` }} onPointerDown={startSlide} onPointerMove={moveSlide} onPointerUp={finishSlide} onPointerCancel={finishSlide}><ArrowRight size={18}/></button></div>
          {error && <div className="closing-modal-error"><AlertTriangle size={14}/>{error}</div>}
        </div>
        <footer className="item-editor-footer closing-modal-footer"><span>Solo Administrador o Gerente</span><button className="secondary" disabled={saving} onClick={closeModal}>Cancelar</button></footer>
      </section>
    </div>}

    {detailOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetailOpen(null) }}>
      <section className="item-editor-modal closure-detail-modal" role="dialog" aria-modal="true" aria-labelledby="closure-detail-title">
        <header className="item-editor-head"><div><span className="item-editor-kicker">CIERRE ADMINISTRATIVO</span><h3 id="closure-detail-title">{displayDay(detailOpen.dateKey)}</h3><p>Cerrado por {detailOpen.userName} · {date(detailOpen.closedAt)} · {time(detailOpen.closedAt)}</p></div><button className="item-editor-close" onClick={() => setDetailOpen(null)}><X size={18}/></button></header>
        <div className="item-editor-body closure-detail-body">
          <div className="closure-detail-summary"><div><span>Facturas</span><strong>{detailOpen.saleCount}</strong></div><div><span>Ventas</span><strong>{money(detailOpen.total)}</strong></div><div><span>Efectivo</span><strong>{money(detailOpen.cash)}</strong></div><div><span>Diferencia</span><strong>{detailOpen.cashDifference === 0 ? '$0' : `${detailOpen.cashDifference > 0 ? '+' : ''}${money(detailOpen.cashDifference)}`}</strong></div></div>
          <div className="closure-detail-invoices"><div className="panel-title"><div><h2>Facturas del cierre</h2><p>Comprobantes conservados para revisión.</p></div></div>{!detailOpen.sales.length ? <div className="closing-empty compact"><FileText size={22}/><span>No hubo ventas en este cierre.</span></div> : <div className="closure-invoice-list">{detailOpen.sales.map(sale => <article key={sale.id} className="closure-invoice-row"><div className="closure-invoice-index"><b>#{sale.orderNumber ?? sale.id.slice(-6)}</b><span>{time(sale.createdAt)}</span></div><div className="closure-invoice-main"><b>{sale.customerName || 'Consumidor final'}</b><span>{sale.items.map(item => `${item.quantity}× ${item.name}`).join(', ')}</span></div><div className="closure-invoice-payment">{paymentLabel(sale.payment)}</div><strong>{money(sale.total)}</strong><button className="sales-print-btn" onClick={() => printInvoice(sale)}><FileText size={13}/> Factura</button></article>)}</div>}</div>
        </div>
      </section>
    </div>}
  </div>
}
