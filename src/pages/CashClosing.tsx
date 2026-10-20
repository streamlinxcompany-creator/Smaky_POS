import { AlertTriangle, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Eye, LockKeyhole, Printer, ReceiptText, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { addBusinessDay, businessDayKey, createDailyClosure, deletePreviousDayClosure, getClosures, getCurrentBusinessDayKey, getGeneralSettings, getSales, recordBusinessDayKey, summarizeClosureSales } from '../lib/store'
import { getSessionUser, hasPermission } from '../lib/auth'
import { money, date, time } from '../lib/format'
import type { CashClosure, Sale } from '../lib/types'
import { printCashClosingReceipt } from '../lib/print'

export function CashClosing() {
  const actor = getSessionUser()
  const [closures, setClosures] = useState<CashClosure[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [dateKey, setDateKey] = useState('')
  const [cashCounted, setCashCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState(false)
  const [detail, setDetail] = useState<CashClosure | null>(null)
  const [toast, setToast] = useState('')
  const [closureFontSize, setClosureFontSize] = useState(11)
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<58 | 80 | 88>(58)

  const load = async () => {
    const [nextClosures, nextSales, currentKey, settings] = await Promise.all([getClosures(), getSales(), getCurrentBusinessDayKey(), getGeneralSettings()])
    setClosures(nextClosures)
    setSales(nextSales)
    setClosureFontSize(settings.closureFontSize || 11)
    setReceiptPaperWidth(settings.receiptPaperWidth || 58)
    setDateKey(currentKey)
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    const handleSettingsChange = () => { void getGeneralSettings().then(settings => { setClosureFontSize(settings.closureFontSize || 11); setReceiptPaperWidth(settings.receiptPaperWidth || 58) }) }
    window.addEventListener('smaky-settings-change', handleSettingsChange)
    return () => window.removeEventListener('smaky-settings-change', handleSettingsChange)
  }, [])
  useEffect(() => {
    const handleSyncChange = () => { void load() }
    window.addEventListener('smaky-sync-change', handleSyncChange)
    return () => window.removeEventListener('smaky-sync-change', handleSyncChange)
  }, [])
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(''), 3000); return () => window.clearTimeout(t) }, [toast])

  const currentClosure = useMemo(() => closures.find(item => item.dateKey === dateKey), [closures, dateKey])
  // Misma regla que el registro del cierre (store.summarizeClosureSales): lo que
  // se ve antes de confirmar es exactamente lo que queda guardado.
  const daySales = useMemo(() => sales.filter(sale => !sale.deletedAt && recordBusinessDayKey(sale) === dateKey), [sales, dateKey])
  const totals = useMemo(() => summarizeClosureSales(daySales), [daySales])

  const canClose = Boolean(actor && hasPermission(actor, 'cashClosing.access'))
  const difference = Number(cashCounted || 0) - totals.cash

  const openClose = () => {
    setCashCounted(String(Math.max(0, Math.round(totals.cash))))
    setNotes('')
    setModal(true)
  }

  const confirmClose = async () => {
    if (!actor || currentClosure || saving) return
    setSaving(true)
    try {
      const created = await createDailyClosure(dateKey, actor, Number(cashCounted || 0), notes)
      if (!created) throw new Error('No fue posible registrar el cierre.')
      setModal(false)
      setToast('Cierre registrado. Quedó protegido y se sincronizará con Supabase automáticamente.')
      await load()
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'No fue posible registrar el cierre.')
    } finally { setSaving(false) }
  }

  const deletePrevious = async (closure: CashClosure) => {
    if (!actor || actor.role !== 'manager') return
    const ok = await deletePreviousDayClosure(closure.id, actor)
    setToast(ok ? 'Cierre anterior archivado.' : 'No se pudo archivar el cierre anterior.')
    if (ok) await load()
  }

  const printClosure = (closure: CashClosure) => {
    const printed = printCashClosingReceipt(closure, closureFontSize, receiptPaperWidth)
    if (!printed) setToast('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para Smaky.')
  }

  const previousKey = addBusinessDay(dateKey || businessDayKey(new Date()), -1)
  const previousClosure = closures.find(item => item.dateKey === previousKey)

  if (!actor) return <div className="cash-closing-page"><div className="panel closing-empty"><LockKeyhole size={26}/><b>Sesión requerida</b><span>Inicia sesión para gestionar el cierre de caja.</span></div></div>

  return <div className="cash-closing-page">
    <div className="page-heading compact cash-closing-heading">
      <div><p className="eyebrow">CAJA</p><h1>Cierre de caja</h1><p className="muted">El cierre queda protegido y sincronizado con Supabase; el modo offline lo conserva hasta recuperar la conexión.</p></div>
      <div className={`closing-status-pill ${currentClosure ? 'closed' : daySales.length ? 'pending' : 'blocked'}`}>{currentClosure ? <CheckCircle2 size={15}/> : <Clock3 size={15}/>} {currentClosure ? 'DÍA CERRADO' : daySales.length ? 'PENDIENTE DE CIERRE' : 'SIN VENTAS'}</div>
    </div>

    <div className="closing-grid-top">
      <section className="panel closing-main-card">
        <div className="closing-main-top"><div><span className="eyebrow">PERÍODO OPERATIVO</span><h2>{dateKey || 'Cargando…'}</h2><p>{daySales.length} ventas registradas en este período.</p></div><div className={`closing-state ${currentClosure ? 'done' : ''}`}>{currentClosure ? '✓' : 'OPEN'}</div></div>
        {currentClosure ? <div className="closing-closed-banner"><CheckCircle2 size={19}/><div><b>Cierre confirmado</b><span>{time(currentClosure.closedAt)} · contado {money(currentClosure.cashCounted)} · diferencia {money(currentClosure.cashDifference)}</span></div><button className="secondary closing-print-btn" onClick={() => void printClosure(currentClosure)}><Printer size={14}/> Imprimir cierre</button></div> : <div className="closing-warning"><ReceiptText size={18}/><div><b>El cierre congela este período.</b><span>Después del cierre no se podrán registrar nuevas ventas para {dateKey}.</span></div></div>}
        <div className="closing-stats"><div><span>Ventas</span><strong>{daySales.length}</strong></div><div><span>Total</span><strong>{money(totals.total)}</strong></div><div><span>Efectivo</span><strong>{money(totals.cash)}</strong></div><div><span>Transferencias</span><strong>{money(totals.transfer)}</strong></div><div><span>Tarjetas</span><strong>{money(totals.card)}</strong></div></div>
        {!currentClosure && canClose && daySales.length > 0 && <div className="closing-action-card"><div><span>CIERRE ADMINISTRATIVO</span><small>Verifica el efectivo físico antes de confirmar.</small></div><button className="primary" onClick={openClose}>ABRIR CIERRE <ChevronRight size={16}/></button></div>}
      </section>

      <section className="panel closing-next-card">
        <span className="eyebrow">SIGUIENTE PERÍODO</span><div className="next-close-date"><span>Después de cerrar</span><strong>{date(addBusinessDay(dateKey || businessDayKey(new Date()), 1))}</strong><small>El POS continuará en este siguiente día operativo.</small></div>
        <div className="next-close-note">Las ventas se agrupan por fecha operativa de Colombia para evitar desfases alrededor de medianoche.</div>
      </section>
    </div>

    <section className="panel closure-history-panel">
      <div className="panel-title"><div><h2>Historial de cierres</h2><p>Los cierres anteriores permanecen disponibles para consulta y recuperación administrativa.</p></div><span className="closure-history-count">{closures.length} cierres</span></div>
      {closures.length ? <div className="closure-history-list">{closures.map(closure => <div className="closure-history-row" key={closure.id}><div className="closure-history-index"><CircleDollarSign size={16}/></div><div className="closure-history-main"><b>{closure.dateKey}</b><span>{closure.userName} · {date(closure.closedAt)} {time(closure.closedAt)}</span></div><div className="closure-history-total"><small>Total</small><strong>{money(closure.total)}</strong></div><span className={`closure-difference ${closure.cashDifference === 0 ? 'ok' : ''}`}>{closure.cashDifference === 0 ? 'CUADRE OK' : `DIF. ${money(closure.cashDifference)}`}</span><button className="secondary closure-view-btn" onClick={() => setDetail(closure)}><Eye size={14}/> Ver</button><button className="secondary closure-print-history-btn" onClick={() => void printClosure(closure)} title="Imprimir cierre"><Printer size={14}/></button></div>)}</div> : <div className="closing-empty"><Clock3 size={26}/><b>Aún no hay cierres</b><span>Cuando cierres el primer período aparecerá aquí.</span></div>}
    </section>

    {actor.role === 'manager' && previousClosure && <section className="panel closing-warning-box"><div><b>Corrección administrativa disponible</b><span>El cierre del período anterior puede archivarse por un gerente.</span></div><button className="secondary" onClick={() => void deletePrevious(previousClosure)}><Trash2 size={14}/> Archivar anterior</button></section>}

    {modal && <div className="closing-backdrop"><div className="closing-modal" role="dialog" aria-modal="true"><div className="closing-modal-head"><div><span className="eyebrow">CONFIRMAR CIERRE</span><h2>{dateKey}</h2></div><button onClick={() => setModal(false)} aria-label="Cerrar"><X size={18}/></button></div><div className="closing-modal-body"><div className="closing-modal-summary"><div><span>Ventas</span><b>{daySales.length}</b></div><div><span>Total</span><b>{money(totals.total)}</b></div><div><span>Efectivo esperado</span><b>{money(totals.cash)}</b></div><div><span>Contado</span><b>{money(Number(cashCounted || 0))}</b></div></div><label className="closing-cash-input"><span>EFECTIVO CONTADO</span><input autoFocus type="number" min="0" value={cashCounted} onChange={e => setCashCounted(e.target.value)}/><small>Esperado: {money(totals.cash)}</small></label><div className={`cash-difference-box ${difference === 0 ? 'ok' : difference > 0 ? 'surplus' : ''}`}><div>Diferencia de caja: <b>{money(difference)}</b></div></div><label className="closing-note-input"><span>NOTAS</span><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Observaciones del cierre…"/></label><div className="closing-confirm-warning"><LockKeyhole size={14}/><span>Confirmar creará un registro inmutable del cierre y bloqueará nuevas ventas de este período.</span></div></div><div className="closing-modal-footer"><span>El registro se sincroniza automáticamente cuando vuelve la conexión.</span><button className="primary" disabled={saving} onClick={() => void confirmClose()}>{saving ? 'GUARDANDO…' : 'CONFIRMAR CIERRE'}</button></div></div></div>}

    {detail && <ClosureDetail closure={detail} onClose={() => setDetail(null)} onPrint={() => void printClosure(detail)} />}
    {toast && <div className="closing-toast">{toast}</div>}
  </div>
}

const fallbackPaymentLabels: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta', multiple: 'Pago mixto' }

const longDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  if (!year || !month || !day) return dateKey
  const text = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function ClosureDetail({ closure, onClose, onPrint }: { closure: CashClosure; onClose: () => void; onPrint: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const difference = Number(closure.cashDifference) || 0
  const status = difference === 0 ? 'ok' : difference > 0 ? 'surplus' : 'short'
  const statusLabel = status === 'ok' ? 'Cuadre exacto' : status === 'surplus' ? 'Sobrante' : 'Faltante'
  const activeSales = (Array.isArray(closure.sales) ? closure.sales : []).filter(sale => !sale.deletedAt)
    .sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0) || a.createdAt.localeCompare(b.createdAt))
  const labelFor = (id: string) => closure.paymentLabels?.[id] || fallbackPaymentLabels[id] || id
  const payments = Object.entries(closure.payments && Object.keys(closure.payments).length ? closure.payments : { cash: closure.cash, transfer: closure.transfer, card: closure.card })
    .map(([id, amount]) => ({
      id,
      label: labelFor(id),
      amount: Number(amount) || 0,
      count: activeSales.filter(sale => sale.paymentAllocations?.length ? sale.paymentAllocations.some(item => item.method === id) : sale.payment === id).length,
    }))
    .filter(item => item.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
  const paymentTotal = payments.reduce((sum, item) => sum + item.amount, 0) || 1

  return <div className="cdm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="cdm" role="dialog" aria-modal="true" aria-labelledby="cdm-title">
      <header className="cdm-head">
        <div>
          <span className="cdm-eyebrow">Detalle de cierre</span>
          <h2 id="cdm-title">{longDate(closure.dateKey)}</h2>
          <p>Cerrado a las {time(closure.closedAt)} por {closure.userName || '—'}</p>
        </div>
        <button className="cdm-close" onClick={onClose} aria-label="Cerrar detalle"><X size={18}/></button>
      </header>

      <div className="cdm-body">
        {closure.storedTotals && <div className="cdm-notice">
          <AlertTriangle size={18}/>
          <div>
            <b>Valores corregidos</b>
            <span>Este cierre se guardó sumando {closure.storedTotals.excludedSales} {closure.storedTotals.excludedSales === 1 ? 'venta eliminada' : 'ventas eliminadas'} ({money(closure.storedTotals.excludedTotal)}). Aquí se muestran sin ellas. Antes decía: total {money(closure.storedTotals.total)} · efectivo esperado {money(closure.storedTotals.cashExpected)} · diferencia {money(closure.storedTotals.cashDifference)}.</span>
          </div>
        </div>}

        <div className="cdm-hero">
          <div className="cdm-hero-main">
            <span>Total vendido</span>
            <strong>{money(closure.total)}</strong>
            <small>{closure.saleCount} {closure.saleCount === 1 ? 'venta' : 'ventas'}</small>
          </div>
          <div className={`cdm-status cdm-status-${status}`}>
            {status === 'ok' ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}
            <div><span>{statusLabel}</span><strong>{status === 'ok' ? 'Caja cuadrada' : money(Math.abs(difference))}</strong></div>
          </div>
        </div>

        <div className="cdm-section">
          <h3>Arqueo de efectivo</h3>
          <div className="cdm-arqueo">
            <div><span>Esperado</span><strong>{money(closure.cashExpected)}</strong></div>
            <div><span>Contado</span><strong>{money(closure.cashCounted)}</strong></div>
            <div className={`cdm-diff cdm-status-${status}`}><span>Diferencia</span><strong>{difference > 0 ? '+' : ''}{money(difference)}</strong></div>
          </div>
        </div>

        <div className="cdm-section">
          <h3>Medios de pago</h3>
          {payments.length ? <div className="cdm-payments">{payments.map(item => <div className="cdm-payment" key={item.id}>
            <div className="cdm-payment-top"><span>{item.label}<small>{item.count} {item.count === 1 ? 'venta' : 'ventas'}</small></span><strong>{money(item.amount)}</strong></div>
            <div className="cdm-bar"><i style={{ width: `${Math.max(2, Math.round(item.amount / paymentTotal * 100))}%` }}/></div>
          </div>)}</div> : <p className="cdm-empty">Sin movimientos en este período.</p>}
        </div>

        {activeSales.length > 0 && <div className="cdm-section">
          <h3>Ventas incluidas <span>{activeSales.length}</span></h3>
          <div className="cdm-sales">{activeSales.map(sale => <div className="cdm-sale" key={sale.id}>
            <b>#{sale.orderNumber ?? sale.id.slice(-4).toUpperCase()}</b>
            <span className="cdm-sale-who">{sale.customerName || 'Consumidor final'}<small>{time(sale.createdAt)} · {sale.paymentAllocations && sale.paymentAllocations.length > 1 ? 'Pago mixto' : (sale.paymentLabel || labelFor(sale.payment))}</small></span>
            <strong>{money(sale.total)}</strong>
          </div>)}</div>
        </div>}

        {closure.notes && <div className="cdm-section cdm-notes"><h3>Notas</h3><p>{closure.notes}</p></div>}
      </div>

      <footer className="cdm-foot">
        <button className="secondary" onClick={onClose}>Cerrar</button>
        <button className="cdm-print" onClick={onPrint}><Printer size={15}/> Imprimir cierre</button>
      </footer>
    </section>
  </div>
}
