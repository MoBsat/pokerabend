import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    flowType: 'pkce',          // Bestätigungslinks kommen als ?code=… zurück (kollidiert nicht mit dem #-Routing)
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Wirft den Supabase-Fehler, sonst gibt es die Daten zurück
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

export const baseUrl = () => location.origin + location.pathname;
