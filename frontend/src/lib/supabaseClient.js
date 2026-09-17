import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY müssen gesetzt sein (.env.local anlegen, siehe .env.local.example).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
