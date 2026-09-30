import { ArrowRight, FileText, Printer, ShieldAlert, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { deleteSale, getSales } from '../lib/store'
import { money, time, date } from '../lib/format'
import type { PaymentMethod, Sale } from '../lib/types'
import { getSessionUser } from '../lib/auth'
import { printSaleReceipt } from '../lib/print'

const paymentLabel = (payment: PaymentMethod) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : 'Tarjeta'

export function Sales() {
  const [sales, setSales] = useState<Sale[]>([])
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const deleteProgressRef = useRef(0)
  const deleteSliderRef = useRef<HTMLDivElement | null>(null)
  const deleteDraggingRef = useRef(false)
  const deleteDragStartXRef = useRef(0)
  const deleteDragStartProgressRef = useRef(0)
  const sessionUser = getSessionUser()
  const canDelete = sessionUser?.role === 'manager' || sessionUser?.role === 'admin'

  useEffect(() => { getSales().then(setSales) }, [])

  const closeReceipt = () => {
    setSelectedSale(null)
    setConfirmDelete(false)
    deleteProgressRef.current = 0
    setDeleteProgress(0)
  }

  const updateDeleteSlide = (event: PointerEvent<HTMLDivElement>) => {
    if (deleting || !deleteDraggingRef.current || !deleteSliderRef.current) return
    const sliderBounds = deleteSliderRef.current.getBoundingClientRect()
    const thumbWidth = event.currentTarget.getBoundingClientRect().width
    const travel = Math.max(1, sliderBounds.width - thumbWidth - 10)
    const delta = ((event.clientX - deleteDragStartXRef.current) / travel) * 100
    const next = Math.max(0, Math.min(100, deleteDragStartProgressRef.current + delta))
    deleteProgressRef.current = next
    setDeleteProgress(next)
  }

  const slideDeleteDown = (event: PointerEvent<HTMLDivElement>) => {
    if (deleting || !deleteSliderRef.current) return
    deleteDraggingRef.current = true
    deleteDragStartXRef.current = event.clientX
    deleteDragStartProgressRef.current = deleteProgressRef.current
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const performDelete = async () => {
    if (!selectedSale || !sessionUser || deleteProgressRef.current < 92 || deleting) return
    setDeleting(true)
    try {
      const removed = await deleteSale(selectedSale.id, sessionUser.id)
      if (!removed) return
      setSales(current => current.filter(sale => sale.id !== selectedSale.id))
      setDeleting(false)
      closeReceipt()
      return
    } finally {
      setDeleting(false)
    }
  }

  const slideDeleteUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!deleteDraggingRef.current) return
    deleteDraggingRef.current = false
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    if (deleteProgressRef.current >= 92 && !deleting) void performDelete()
  }

  return <div>
    <div className="page-heading compact">
      <div><p className="eyebrow">HISTORIAL</p><h1>Ventas</h1><p className="muted">Todas las transacciones registradas. Haz clic en una venta para ver su comprobante.</p></div>
    </div>

    <div className="panel table-panel">
      {sales.length === 0 ? <div className="sales-empty"><FileText size={30}/><b>Aún no hay ventas</b><span>Las ventas confirmadas desde el punto de venta aparecerán aquí.</span></div> : <table>
        <thead><tr><th>Fecha</th><th>Pedido</th><th>Usuario</th><th>Pago</th><th>Total</th><th>Factura</th></tr></thead>
        <tbody>{sales.map(sale => <tr key={sale.id} className="clickable-row" onClick={() => setSelectedSale(sale)}>
          <td>{date(sale.createdAt)} · {time(sale.createdAt)}</td>
          <td><b>#{sale.orderNumber ?? sale.id.slice(-6).toUpperCase()}</b><div className="sales-customer">{sale.customerName || 'Consumidor final'}</div></td>
          <td>{sale.userName}</td>
          <td><span className="badge">{paymentLabel(sale.payment)}</span></td>
          <td><b>{money(sale.total)}</b></td>
          <td><button className="sales-print-btn" title="Imprimir factura" onClick={(event) => { event.stopPropagation(); printSaleReceipt(sale) }}><Printer size={14}/> Factura</button></td>
        </tr>)}</tbody>
      </table>}
    </div>

    {selectedSale && <div className="modal-backdrop receipt-backdrop">
      <div className="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <button className="receipt-close" onClick={closeReceipt} aria-label="Cerrar"><X size={18}/></button>
        <div className="receipt-top">
          <div className="receipt-brand-mark">S</div>
          <p className="eyebrow">COMPROBANTE</p>
          <h2 id="receipt-title">Smaky Burgers</h2>
          <span>Venta #{selectedSale.id.slice(-6).toUpperCase()}</span>
        </div>

        <div className="receipt-meta">
          <div><span>Pedido</span><b>#{selectedSale.orderNumber ?? selectedSale.id.slice(-6).toUpperCase()}</b></div>
          <div><span>Cliente</span><b>{selectedSale.customerName || 'Consumidor final'}</b></div>
          <div><span>Pago</span><b>{paymentLabel(selectedSale.payment)}</b></div>
          <div><span>Fecha</span><b>{date(selectedSale.createdAt)} · {time(selectedSale.createdAt)}</b></div>
          <div><span>Atendido por</span><b>{selectedSale.userName}</b></div>
          <div><span>Dirección</span><b>{selectedSale.address || '—'}</b></div>
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
        <button className="secondary receipt-print-btn" onClick={() => printSaleReceipt(selectedSale)}><Printer size={15}/> Imprimir factura</button>
        {canDelete && <div className="receipt-danger">
          <button className="delete-sale-btn" onClick={() => { setConfirmDelete(true); deleteProgressRef.current = 0; setDeleteProgress(0) }}><Trash2 size={15}/> Eliminar esta venta</button>
        </div>}
        <div className="receipt-footer">Gracias por tu compra · Smaky POS</div>
      </div>
    </div>}

    {confirmDelete && selectedSale && <div className="modal-backdrop danger-backdrop">
      <div className="delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-sale-title">
        <div className="delete-confirm-icon"><ShieldAlert size={22}/></div>
        <span className="eyebrow danger-eyebrow">ELIMINAR VENTA</span>
        <h2 id="delete-sale-title">¿Seguro que quieres eliminar esta venta?</h2>
        <p className="delete-confirm-copy">Venta #{selectedSale.id.slice(-6).toUpperCase()} · {money(selectedSale.total)} · {selectedSale.userName}. Esta acción quitará la venta del historial.</p>
        <div ref={deleteSliderRef} className={`delete-slider ${deleteProgress >= 92 ? 'ready' : ''}`}>
          <div className="delete-slider-fill" style={{width: `${Math.max(0, deleteProgress)}%`}}/>
          <div className="delete-slider-text">{deleting ? 'Eliminando…' : deleteProgress >= 92 ? 'Suelta para eliminar' : 'Arrastra el botón →'}</div>
          <div
            className="delete-slider-thumb"
            style={{left: `calc(${Math.max(0, Math.min(92, deleteProgress))}% - 0px)`}}
            onPointerDown={slideDeleteDown}
            onPointerMove={updateDeleteSlide}
            onPointerUp={slideDeleteUp}
            onPointerCancel={slideDeleteUp}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(deleteProgress)}
            aria-label="Arrastrar para confirmar la eliminación"
          ><ArrowRight size={18}/></div>
        </div>
        <button className="cancel-delete-btn" disabled={deleting} onClick={() => { setConfirmDelete(false); deleteProgressRef.current = 0; setDeleteProgress(0) }}>Cancelar</button>
      </div>
    </div>}
  </div>
}
