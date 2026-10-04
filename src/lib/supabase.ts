import { createClient } from '@supabase/supabase-js'

// Public project configuration. This key is safe to ship to the browser
// when Row Level Security (RLS) is enabled in Supabase.
const supabaseUrl = 'https://jipmbegkgxnlqthmbvpp.supabase.co'
const supabaseKey = 'sb_publishable_-zmFxlip9lpmMseQwtAZ2Q_Wns2hb5Q'

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey)

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null
