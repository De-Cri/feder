import { createClient } from '@supabase/supabase-js';
import { config, configured } from './config';
import { retryOnExpiredJwt } from './authFetch';

// Set right after the client exists (the client's fetch needs the client to renew the login).
let renewLogin = async (): Promise<string | null> => null;

export const supabase = createClient(
  configured ? config.supabaseUrl : 'http://localhost',
  configured ? config.supabaseAnonKey : 'unconfigured',
  {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cerchio-auth' },
    realtime: { params: { eventsPerSecond: 40 } },
    global: {
      fetch: retryOnExpiredJwt((input, init) => fetch(input, init), () => renewLogin()),
    },
  },
);

renewLogin = async () => (await supabase.auth.refreshSession()).data.session?.access_token ?? null;

// supabase-js stops renewing the login while the window is hidden (meant for browser
// tabs). Feder stays in calls and in the tray for hours with the window hidden: after
// an hour the token expired, calls and notifications broke ("JWT expired").
// This keeps renewing it always; the requests in different tabs coordinate with a lock.
// After initialize(): that's where supabase-js hooks up its hidden-window pause, which
// startAutoRefresh() removes.
if (configured) {
  void supabase.auth.initialize().then(() => supabase.auth.startAutoRefresh());
}
