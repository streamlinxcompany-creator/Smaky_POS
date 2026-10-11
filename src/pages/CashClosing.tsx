import { CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Eye, LockKeyhole, Printer, ReceiptText, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { addBusinessDay, businessDayKey, createDailyClosure, deletePreviousDayClosure, getClosures, getCurrentBusinessDayKey, getGeneralSettings, getSales } from '../lib/store'
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
  const daySales = useMemo(() => sales.filter(sale => !sale.deletedAt && businessDayKey(sale.createdAt) === dateKey), [sales, dateKey])
  const totals = useMemo(() => daySales.reduce((acc, sale) => {
    acc.total += sale.total
    if (sale.payment === 'cash') acc.cash += sale.total
    else if (sale.payment === 'transfer') acc.transfer += sale.total
    else if (sale.payment === 'card') acc.card += sale.total
    return acc
  }, { total: 0, cash: 0, transfer: 0, card: 0 }), [daySales])

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

    {detail && <div className="closing-backdrop">
      <div className="closing-modal closure-detail-modal" role="dialog" aria-modal="true">
        <div className="closing-modal-head">
          <div><span className="eyebrow">DETALLE DE CIERRE</span><h2>{detail.dateKey}</h2></div>
          <button onClick={() => setDetail(null)} aria-label="Cerrar"><X size={18}/></button>
        </div>
        <div className="closing-modal-body closure-detail-body">
          <div className="closure-detail-summary">
            <div><span>Ventas</span><strong>{detail.saleCount}</strong></div>
            <div><span>Total</span><strong>{money(detail.total)}</strong></div>
            <div><span>Efectivo esperado</span><strong>{money(detail.cashExpected)}</strong></div>
            <div><span>Efectivo contado</span><strong>{money(detail.cashCounted)}</strong></div>
          </div>
          <div className="closure-cash-verification">
            <div><span>Cuadre</span><strong>{money(detail.cashDifference)}</strong><b>{detail.cashDifference === 0 ? 'OK' : detail.cashDifference > 0 ? 'SOBRANTE' : 'FALTANTE'}</b></div>
            <div><span>Atendido por</span><strong>{detail.userName}</strong></div>
            <div><span>Hora</span><strong>{time(detail.closedAt)}</strong></div>
          </div>
          <div className="closure-detail-summary-block">
            <div className="closure-detail-subtitle">Resumen por medio de pago</div>
            {Object.entries(detail.payments && Object.keys(detail.payments).length ? detail.payments : { cash: detail.cash, transfer: detail.transfer, card: detail.card }).filter(([, amount]) => Number(amount) !== 0).map(([id, amount]) => <div className="closure-detail-payment-row" key={id}><span>{detail.paymentLabels?.[id] || (id === 'cash' ? 'Efectivo' : id === 'transfer' ? 'Transferencia' : id === 'card' ? 'Tarjeta' : id)}</span><strong>{money(Number(amount) || 0)}</strong></div>)}
          </div>
          {detail.notes && <div className="closure-detail-note"><ReceiptText size={16}/><div><b>Notas</b><span>{detail.notes}</span></div></div>}
        </div>
        <div className="closing-modal-footer closure-detail-footer">
          <button className="secondary" onClick={() => setDetail(null)}>Cerrar</button>
          <button className="primary" onClick={() => void printClosure(detail)}><Printer size={15}/> Imprimir cierre</button>
        </div>
      </div>
    </div>}
    {toast && <div className="closing-toast">{toast}</div>}
  </div>
}
