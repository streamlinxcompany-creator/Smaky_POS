import type { ReactNode } from 'react'
export function StatCard({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: ReactNode }) { return <div className="stat-card"><div className="stat-head"><span>{label}</span><div className="stat-icon">{icon}</div></div><strong>{value}</strong>{hint && <small>{hint}</small>}</div> }
