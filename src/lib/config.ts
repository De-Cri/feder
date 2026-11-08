import raw from '../../cerchio.config.json';

export const config = raw as { supabaseUrl: string; supabaseAnonKey: string; turn: boolean };
export const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
