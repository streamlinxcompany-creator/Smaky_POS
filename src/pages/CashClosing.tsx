import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, ChevronRight, DatabaseZap, FileText, LockKeyhole, ReceiptText, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { getSessionUser } from '../lib/auth'
import { addBusinessDay, businessDayKey, createDailyClosure, deletePreviousDayClosure, getClosures, getOrders, getPaymentMethods, getSales, recordBusinessDayKey, resetTestData } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { CashClosure, Order, Sale } from '../lib/types'
import { printCashClosure, printSaleReceipt } from '../lib/print'

const fallbackPaymentLabel = (payment: Sale['payment']) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : payment === 'card' ? 'Tarjeta' : payment
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
  const [paymentLabels, setPaymentLabels] = useState<Record<string,string>>({})
  const [orders, setOrders] = useState<Order[]>([])
  const [closures, setClosures] = useState<CashClosure[]>([])
  const [loading, setLoading] = useState(true)
  const [closeOpen, setCloseOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState<CashClosure | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CashClosure | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
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
  const calendarKey = businessDayKey(new Date())
  const calendarClosure = useMemo(() => closures.find(closure => closure.dateKey === calendarKey) ?? null, [closures, calendarKey])
  const activeKey = calendarClosure?.nextDateKey ?? calendarKey
  const activeClosure = useMemo(() => closures.find(closure => closure.dateKey === activeKey) ?? null, [closures, activeKey])

  const load = async () => {
    setLoading(true)
    const [salesData, ordersData, closureData, methods] = await Promise.all([getSales(), getOrders(), getClosures(), getPaymentMethods()])
    setSales(salesData)
    setOrders(ordersData)
    setClosures(closureData)
    setPaymentLabels(Object.fromEntries(methods.map(method => [method.id, method.name])))
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const todaySales = useMemo(() => sales.filter(sale => recordBusinessDayKey(sale) === activeKey), [sales, activeKey])
  const openOrders = useMemo(() => orders.filter(order => recordBusinessDayKey(order) === activeKey && !['paid', 'cancelled'].includes(order.status)), [orders, activeKey])
  const todaySummary = useMemo(() => todaySales.reduce((acc, sale) => {
    acc.total += sale.total
    acc.payments[sale.payment] = (acc.payments[sale.payment] || 0) + sale.total
    if (sale.payment === 'cash') acc.cash += sale.total
    else if (sale.payment === 'transfer') acc.transfer += sale.total
    else if (sale.payment === 'card') acc.card += sale.total
    return acc
  }, { total: 0, cash: 0, transfer: 0, card: 0, payments: {} as Record<string,number> }), [todaySales])
  const counted = Number(cashCounted || 0)
  const difference = counted - todaySummary.cash
  const nextKey = activeClosure?.nextDateKey ?? addBusinessDay(activeKey, 1)
  const yesterdayKey = addBusinessDay(calendarKey, -1)
  const canDeleteClosure = (closure: CashClosure) => user?.role === 'manager' && closure.dateKey === yesterdayKey
  const canClose = !!user && !activeClosure && openOrders.length === 0 && Number.isFinite(counted) && counted >= 0 && !saving

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
      const closure = await createDailyClosure(activeKey, user, Number(cashCounted), notes)
      if (!closure) throw new Error('No tienes permisos para realizar el cierre.')
      setCloseOpen(false); resetSlider(); setDetailOpen(closure); setMessage(`Cierre del ${shortDay(activeKey)} realizado`)
      await load()
    } catch (caught) {
      resetSlider()
      setError(caught instanceof Error ? caught.message : 'No fue posible cerrar la caja.')
    } finally { setSaving(false) }
  }

  const printInvoice = (sale: Sale) => {
    printSaleReceipt(sale)
  }

  const confirmResetTestData = async () => {
    if (!user || user.role !== 'manager' || resetting) return
    setResetting(true)
    setError('')
    try {
      const reset = await resetTestData(user)
      if (!reset) throw new Error('Solo el gerente puede restablecer los datos de prueba.')
      setResetOpen(false)
      setDetailOpen(null)
      setDeleteTarget(null)
      setMessage('Datos de prueba restablecidos. Productos y usuarios se conservaron.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible restablecer los datos de prueba.')
    } finally {
      setResetting(false)
    }
  }

  const confirmDeleteClosure = async () => {
    if (!deleteTarget || !user || !canDeleteClosure(deleteTarget) || deleting) return
    setDeleting(true)
    setError('')
    try {
      const deleted = await deletePreviousDayClosure(deleteTarget.id, user)
      if (!deleted) throw new Error('Solo el gerente puede eliminar el cierre del día anterior.')
      const deletedDate = shortDay(deleteTarget.dateKey)
      if (detailOpen?.id === deleteTarget.id) setDetailOpen(null)
      setDeleteTarget(null)
      setMessage(`Cierre del ${deletedDate} eliminado. Ya puedes volver a realizar ese cierre.`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible eliminar el cierre.')
    } finally {
      setDeleting(false)
    }
  }

  if (!user) return null
    if (loading) return <div className="closing-loading">Cargando control de caja…</div>

  return <div className="cash-closing-page">
    <div className="page-heading compact cash-closing-heading">
      <div><p className="eyebrow">CONTROL DE CAJA</p><h1>Cierre de caja</h1><p className="muted">Registra el cierre del día, verifica el efectivo y conserva el detalle de las facturas asociadas. Este proceso puede realizarlo el trabajador responsable de la caja.</p></div>
      <div className={`closing-status-pill ${activeClosure ? 'closed' : openOrders.length ? 'blocked' : 'pending'}`}>
        {activeClosure ? <CheckCircle2 size={15}/> : openOrders.length ? <AlertTriangle size={15}/> : <LockKeyhole size={15}/>} 
        {activeClosure ? 'Día cerrado' : openOrders.length ? `${openOrders.length} pedido${openOrders.length === 1 ? '' : 's'} pendiente${openOrders.length === 1 ? '' : 's'}` : 'Cierre pendiente'}
      </div>
      {user.role === 'manager' && <button className="secondary test-reset-btn" onClick={() => { setError(''); setResetOpen(true) }}><DatabaseZap size={15}/> Restablecer pruebas</button>}
    </div>

    <div className="closing-grid-top">
      <section className="panel closing-main-card">
        <div className="closing-main-top"><div><span className="filter-kicker"><LockKeyhole size={14}/> CIERRE DEL DÍA</span><h2>{displayDay(activeKey)}</h2><p>{activeClosure ? `Cerrado el ${date(activeClosure.closedAt)} · ${time(activeClosure.closedAt)} por ${activeClosure.userName}` : 'Todas las ventas del periodo activo se incluirán en este cierre.'}</p></div><div className={`closing-state ${activeClosure ? 'done' : 'open'}`}>{activeClosure ? 'CERRADO' : 'PENDIENTE'}</div></div>
        {activeClosure ? <div className="closing-closed-banner"><CheckCircle2 size={19}/><div><b>El día ya fue cerrado</b><span>El próximo cierre se calculará para el <strong>{shortDay(activeClosure?.nextDateKey ?? nextKey)}</strong>.</span></div><button className="secondary" onClick={() => setDetailOpen(activeClosure)}><FileText size={15}/> Ver facturas</button></div>
          : <>
            {openOrders.length > 0 && <div className="closing-warning"><AlertTriangle size={18}/><div><b>No puedes cerrar todavía</b><span>Hay {openOrders.length} pedido{openOrders.length === 1 ? '' : 's'} abierto{openOrders.length === 1 ? '' : 's'}. Cobra o resuelve los pedidos antes de cerrar el día.</span></div></div>}
            <div className="closing-stats"><div><span>Ventas</span><strong>{todaySales.length}</strong></div><div><span>Total vendido</span><strong>{money(todaySummary.total)}</strong></div>{Object.entries(todaySummary.payments).map(([id, amount]) => <div key={id}><span>{paymentLabels[id] || fallbackPaymentLabel(id)}</span><strong>{money(amount)}</strong></div>)}</div>
            <div className="closing-action-card"><div><span>EFECTIVO A VERIFICAR</span><b>{money(todaySummary.cash)}</b><small>El sistema espera este monto según las ventas en efectivo del día.</small></div><button className="primary" disabled={!!openOrders.length} onClick={openCloseModal}><LockKeyhole size={16}/> Preparar cierre</button></div>
          </>}
      </section>

      <section className="panel closing-next-card">
        <div className="panel-title"><div><h2>Qué pasa después</h2><p>Continuidad automática del cierre diario.</p></div><RotateCcw size={17}/></div>
        <div className="next-close-date"><span>PRÓXIMO PERIODO</span><strong>{shortDay(nextKey)}</strong><small>Una vez cerrado el {shortDay(activeKey)}, las nuevas ventas quedarán asociadas al siguiente día.</small></div>
        <div className="next-close-note"><ShieldCheck size={15}/><span>El cierre guarda el resumen y una copia del detalle de las facturas del día para consulta administrativa.</span></div>
      </section>
    </div>

    <section className="panel closure-history-panel">
      <div className="panel-title"><div><h2>Historial de cierres</h2><p>Cada día cerrado conserva su resumen y sus facturas.</p></div><span className="closure-history-count">{closures.length} cierres</span></div>
      {!closures.length ? <div className="closing-empty"><ReceiptText size={25}/><b>Aún no hay cierres registrados</b><span>El primer cierre aparecerá aquí cuando cierres el día.</span></div> : <div className="closure-history-list">{closures.map(closure => <article className="closure-history-row" key={closure.id}><div className="closure-history-icon"><ReceiptText size={17}/></div><div className="closure-history-main"><b>{shortDay(closure.dateKey)}</b><span>{closure.saleCount} {closure.saleCount === 1 ? 'factura' : 'facturas'} · Cerrado por {closure.userName} a las {time(closure.closedAt)}</span></div><div className="closure-history-total"><small>Total vendido</small><strong>{money(closure.total)}</strong></div><div className={`closure-difference ${closure.cashDifference === 0 ? 'ok' : closure.cashDifference > 0 ? 'surplus' : 'shortage'}`}>{closure.cashDifference === 0 ? 'Caja cuadrada' : `${closure.cashDifference > 0 ? '+' : ''}${money(closure.cashDifference)}`}</div><div className="closure-history-actions"><button className="secondary closure-view-btn" onClick={() => setDetailOpen(closure)}><FileText size={14}/> Ver cierre <ChevronRight size={14}/></button>{canDeleteClosure(closure) && <button className="danger-inline-btn" onClick={() => setDeleteTarget(closure)} disabled={deleting}><RotateCcw size={14}/> Eliminar cierre</button>}</div></article>)}</div>}
    </section>

    {message && <div className="closing-toast"><CheckCircle2 size={16}/>{message}</div>}

    {closeOpen && <div className="modal-backdrop closing-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeModal() }}>
      <section className="item-editor-modal closing-modal" role="dialog" aria-modal="true" aria-labelledby="closing-title">
        <header className="item-editor-head"><div><span className="item-editor-kicker">CONFIRMAR CIERRE</span><h3 id="closing-title">Cerrar caja del {shortDay(activeKey)}</h3><p>Revisa el resumen y confirma cuánto efectivo hay físicamente en caja.</p></div><button className="item-editor-close" disabled={saving} onClick={closeModal}><X size={18}/></button></header>
        <div className="item-editor-body closing-modal-body">
          <div className="closing-modal-summary"><div><span>Ventas</span><b>{todaySales.length}</b></div><div><span>Total vendido</span><b>{money(todaySummary.total)}</b></div><div><span>Efectivo esperado</span><b>{money(todaySummary.cash)}</b></div></div>
          <div className="closing-method-grid">{Object.entries(todaySummary.payments).length ? Object.entries(todaySummary.payments).map(([id, amount]) => <div key={id}><span>{paymentLabels[id] || fallbackPaymentLabel(id)}</span><strong>{money(amount)}</strong></div>) : <div><span>Medios de pago</span><strong>$0</strong></div>}</div>
          <label className="closing-cash-input"><span>EFECTIVO CONTADO</span><input inputMode="numeric" value={cashCounted} onChange={event => setCashCounted(event.target.value.replace(/[^\d]/g, ''))} placeholder="0"/><small>El efectivo contado se compara con el monto esperado.</small></label>
          <div className={`cash-difference-box ${difference === 0 ? 'ok' : difference > 0 ? 'surplus' : 'shortage'}`}><div>{difference === 0 ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span>{difference === 0 ? 'Caja cuadrada' : difference > 0 ? 'Hay un excedente' : 'Hay un faltante'}</span></div><strong>{difference === 0 ? '$0' : `${difference > 0 ? '+' : ''}${money(difference)}`}</strong></div>
          <label className="closing-note-input"><span>OBSERVACIÓN <em>OPCIONAL</em></span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ej. Se retiraron $50.000 para compra de insumos…" /></label>
          <div className="closing-confirm-warning"><AlertTriangle size={15}/><span>Al cerrar <strong>{shortDay(activeKey)}</strong>, este día quedará bloqueado como cierre histórico y el siguiente periodo será <strong>{shortDay(nextKey)}</strong>.</span></div>
          <div className={`closing-slider ${progress >= 96 ? 'ready' : ''}`}><div className="closing-slider-fill" style={{ width: `${progress}%` }}/><span>Desliza para cerrar el día</span><button type="button" disabled={!canClose} className="closing-slider-thumb" style={{ left: `calc(${8 + (Math.min(100, Math.max(0, progress)) * 0.84)}% - 24px)` }} onPointerDown={startSlide} onPointerMove={moveSlide} onPointerUp={finishSlide} onPointerCancel={finishSlide}><ArrowRight size={18}/></button></div>
          {error && <div className="closing-modal-error"><AlertTriangle size={14}/>{error}</div>}
        </div>
        <footer className="item-editor-footer closing-modal-footer"><span>Cierre realizado por {user.name} · {user.role === 'employee' ? 'Trabajador' : user.role === 'manager' ? 'Gerente' : 'Administrador'}</span><button className="secondary" disabled={saving} onClick={closeModal}>Cancelar</button></footer>
      </section>
    </div>}

    {detailOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetailOpen(null) }}>
      <section className="item-editor-modal closure-detail-modal" role="dialog" aria-modal="true" aria-labelledby="closure-detail-title">
        <header className="item-editor-head"><div><span className="item-editor-kicker">FACTURA DE CIERRE · RESUMEN DE CAJA</span><h3 id="closure-detail-title">Cierre del {displayDay(detailOpen.dateKey)}</h3><p>Cerrado por {detailOpen.userName} · {date(detailOpen.closedAt)} · {time(detailOpen.closedAt)}</p></div><button className="item-editor-close" onClick={() => setDetailOpen(null)}><X size={18}/></button></header>
        <div className="item-editor-body closure-detail-body">
          <div className="closure-detail-summary closure-detail-summary-wide"><div><span>Facturas</span><strong>{detailOpen.saleCount}</strong></div><div><span>Total vendido</span><strong>{money(detailOpen.total)}</strong></div><div><span>Efectivo</span><strong>{money(detailOpen.cash)}</strong></div><div><span>Transferencias</span><strong>{money(detailOpen.transfer)}</strong></div><div><span>Tarjetas</span><strong>{money(detailOpen.card)}</strong></div><div><span>Diferencia</span><strong className={detailOpen.cashDifference === 0 ? 'closure-diff-zero' : ''}>{detailOpen.cashDifference === 0 ? '$0' : `${detailOpen.cashDifference > 0 ? '+' : ''}${money(detailOpen.cashDifference)}`}</strong></div></div>
          <div className="closure-cash-verification"><div><span>EFECTIVO ESPERADO</span><strong>{money(detailOpen.cashExpected)}</strong></div><div><span>EFECTIVO CONTADO</span><strong>{money(detailOpen.cashCounted)}</strong></div><div><span>ESTADO</span><b>{detailOpen.cashDifference === 0 ? 'Caja cuadrada' : detailOpen.cashDifference > 0 ? 'Excedente' : 'Faltante'}</b></div></div>
          {detailOpen.notes && <div className="closure-detail-note"><FileText size={14}/><div><b>Observación</b><span>{detailOpen.notes}</span></div></div>}
          <div className="closure-detail-invoices"><div className="panel-title"><div><h2>Facturas del cierre</h2><p>Comprobantes conservados y listos para imprimir.</p></div></div>{!detailOpen.sales.length ? <div className="closing-empty compact"><FileText size={22}/><span>No hubo ventas en este cierre.</span></div> : <div className="closure-invoice-list">{detailOpen.sales.map(sale => <article key={sale.id} className="closure-invoice-row"><div className="closure-invoice-index"><b>#{sale.orderNumber ?? sale.id.slice(-6)}</b><span>{time(sale.createdAt)}</span></div><div className="closure-invoice-main"><b>{sale.customerName || 'Consumidor final'}</b><span>{sale.items.map(item => `${item.quantity}× ${item.name}`).join(', ')}</span></div><div className="closure-invoice-payment">{(sale.paymentLabel || paymentLabels[sale.payment] || fallbackPaymentLabel(sale.payment))}</div><strong>{money(sale.total)}</strong><button className="sales-print-btn" onClick={() => printInvoice(sale)}><FileText size={13}/> Factura</button></article>)}</div>}</div>
        </div>
        <footer className="item-editor-footer closure-detail-footer"><div className="closure-detail-footer-actions"><button className="secondary" onClick={() => setDetailOpen(null)}>Cerrar</button>{canDeleteClosure(detailOpen) && <button className="danger-inline-btn" onClick={() => setDeleteTarget(detailOpen)} disabled={deleting}><RotateCcw size={14}/> Eliminar cierre</button>}</div><button className="primary" onClick={() => printCashClosure(detailOpen)}><FileText size={15}/> Imprimir factura de cierre</button></footer>
      </section>
    </div>}

    {resetOpen && <div className="modal-backdrop danger-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !resetting) setResetOpen(false) }}>
      <section className="delete-confirm-modal test-reset-modal" role="dialog" aria-modal="true" aria-labelledby="test-reset-title">
        <div className="delete-confirm-icon"><DatabaseZap size={21}/></div>
        <span className="danger-eyebrow">MODO DE PRUEBAS · TEMPORAL</span>
        <h2 id="test-reset-title">¿Restablecer los datos de prueba?</h2>
        <p className="delete-confirm-copy">Se borrarán <strong>ventas, pedidos y cierres de caja</strong> de este dispositivo. Los productos, usuarios y configuración se conservarán.</p>
        <div className="closure-delete-summary"><span>Ventas</span><strong>{sales.length}</strong><span>Pedidos</span><strong>{orders.length}</strong><span>Cierres</span><strong>{closures.length}</strong></div>
        <div className="reset-warning"><AlertTriangle size={15}/><span>Esta acción es solo para pruebas y no se puede deshacer.</span></div>
        {error && <div className="closing-modal-error"><AlertTriangle size={14}/>{error}</div>}
        <div className="logout-actions"><button className="cancel-delete-btn" disabled={resetting} onClick={() => setResetOpen(false)}>Cancelar</button><button className="logout-confirm-btn" disabled={resetting} onClick={() => void confirmResetTestData()}>{resetting ? 'Restableciendo…' : 'Sí, borrar datos de prueba'}</button></div>
      </section>
    </div>}

    {deleteTarget && <div className="modal-backdrop danger-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null) }}>
      <section className="delete-confirm-modal closure-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-closure-title">
        <div className="delete-confirm-icon"><RotateCcw size={21}/></div>
        <span className="danger-eyebrow">ELIMINAR CIERRE DE PRUEBA</span>
        <h2 id="delete-closure-title">¿Eliminar el cierre del {shortDay(deleteTarget.dateKey)}?</h2>
        <p className="delete-confirm-copy">Esta opción solo está disponible para el gerente y únicamente para el día anterior. Se eliminará el registro del cierre, pero <strong>no se borrarán las facturas ni las ventas</strong> asociadas.</p>
        <div className="closure-delete-summary"><span>Facturas conservadas</span><strong>{deleteTarget.saleCount}</strong><span>Total conservado</span><strong>{money(deleteTarget.total)}</strong></div>
        <div className="logout-actions"><button className="cancel-delete-btn" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="logout-confirm-btn" disabled={deleting} onClick={() => void confirmDeleteClosure()}>{deleting ? 'Eliminando…' : 'Sí, eliminar cierre'}</button></div>
      </section>
    </div>}
  </div>
}
