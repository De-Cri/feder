// Edge Function opzionale: genera credenziali TURN temporanee (Cloudflare Realtime TURN, free tier)
// solo per i membri del server. Serve quando due amici sono dietro NAT "difficili"
// (es. rete mobile/CGNAT) e la connessione diretta P2P non riesce.
//
// Secrets richiesti:  CF_TURN_KEY_ID, CF_TURN_API_TOKEN
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isMember } = await supabase.rpc('is_member');
  if (!isMember) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors });

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${Deno.env.get('CF_TURN_KEY_ID')}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('CF_TURN_API_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 86400 }),
    },
  );
  if (!res.ok) return new Response(JSON.stringify({ error: 'turn_unavailable' }), { status: 502, headers: cors });
  const body = await res.json();
  return new Response(JSON.stringify({ iceServers: body.iceServers }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
