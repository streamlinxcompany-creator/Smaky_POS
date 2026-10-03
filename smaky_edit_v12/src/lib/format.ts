export const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
export const time = (date: string) => new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(date))
export const date = (dateValue: string) => new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(new Date(dateValue))
