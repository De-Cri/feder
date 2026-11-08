import { createClient } from '@supabase/supabase-js';
import { config, configured } from './config';

export const supabase = createClient(
  configured ? config.supabaseUrl : 'http://localhost',
  configured ? config.supabaseAnonKey : 'unconfigured',
  {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cerchio-auth' },
    realtime: { params: { eventsPerSecond: 40 } },
  },
);
