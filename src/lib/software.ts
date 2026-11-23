/**
 * Identidad de la versión publicada.
 *
 * Al publicar una mejora del POS, actualiza `version` y despliega la misma
 * compilación en todos los dispositivos. La pantalla Configuraciones →
 * Software permite comprobarlo visualmente en cada equipo.
 */
export const SOFTWARE_RELEASE = {
  name: 'StreamLinx Software',
  product: 'Smaky POS',
  version: '3.0.20',
  channel: 'Canal estable',
  build: 'SLX-3.0.20',
  description: 'Menos consultas a Supabase',
} as const
