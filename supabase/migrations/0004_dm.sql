-- =============================================================================
-- Messaggi privati cifrati end-to-end.
--
-- Il server non vede mai il testo: ogni membro ha una coppia di chiavi (ECDH P-256)
-- creata nell'app; la chiave privata arriva qui solo cifrata con il codice di recupero,
-- casuale, che il server non conosce. Il server vede solo chi scrive a chi e quando.
--
-- - I messaggi si leggono solo se sei mittente o destinatario (RLS); in tempo reale
--   arrivano solo a quei due (postgres_changes rispetta l'RLS), niente broadcast.
-- - Si scrive solo con dm_send: limiti anti-spam e anti-broadcast lato server.
-- - Dopo 30 giorni un messaggio sparisce per chi non gli ha messo la stellina;
--   quando non ce l'ha più nessuno viene cancellato (dm_purge, senza pg_cron).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Chiavi
-- -----------------------------------------------------------------------------
create table public.dm_keys (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  public_key  text not null check (char_length(public_key) between 40 and 200),
  -- chiave privata (pkcs8) cifrata con AES-GCM, chiave derivata dal codice con PBKDF2
  wrapped_key text not null check (char_length(wrapped_key) between 40 and 400),
  salt        text not null check (char_length(salt) between 16 and 64),
  iv          text not null check (char_length(iv) between 12 and 32),
  iterations  int  not null check (iterations between 100000 and 5000000),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Messaggi
-- -----------------------------------------------------------------------------
create table public.dm_messages (
  id            bigint generated always as identity primary key,
  sender        uuid not null references public.profiles (id) on delete cascade,
  recipient     uuid not null references public.profiles (id) on delete cascade,
  -- chiavi pubbliche in uso all'invio: se una delle due persone rigenera il codice,
  -- l'altra continua a leggere la cronologia
  sender_pub    text not null,
  recipient_pub text not null,
  iv            text not null check (char_length(iv) between 12 and 32),
  -- testo cifrato in base64: 2000 caratteri in chiaro stanno sotto 11000
  body          text not null check (char_length(body) between 1 and 11000),
  created_at    timestamptz not null default now(),
  check (sender <> recipient)
);
create index dm_messages_sender_idx    on public.dm_messages (sender, created_at desc);
create index dm_messages_recipient_idx on public.dm_messages (recipient, created_at desc);
create index dm_messages_created_idx   on public.dm_messages (created_at);

-- Stellina personale: ognuno vede solo le proprie.
create table public.dm_stars (
  user_id    uuid   not null references public.profiles (id) on delete cascade,
  message_id bigint not null references public.dm_messages (id) on delete cascade,
  primary key (user_id, message_id)
);
create index dm_stars_message_idx on public.dm_stars (message_id);

-- -----------------------------------------------------------------------------
-- Helper
-- -----------------------------------------------------------------------------

-- Visibile per me: sono uno dei due e il messaggio ha meno di 30 giorni o la mia stellina.
create or replace function public.dm_visible(p_sender uuid, p_recipient uuid, p_created timestamptz, p_id bigint)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() in (p_sender, p_recipient)
     and (p_created > now() - interval '30 days'
          or exists (select 1 from public.dm_stars s where s.message_id = p_id and s.user_id = auth.uid()));
$$;
revoke execute on function public.dm_visible(uuid, uuid, timestamptz, bigint) from public, anon;
grant execute on function public.dm_visible(uuid, uuid, timestamptz, bigint) to authenticated;

-- Cancella i messaggi scaduti senza stelline.
create or replace function private.dm_purge()
returns void
language sql volatile security definer
set search_path = ''
as $$
  delete from public.dm_messages m
  where m.created_at < now() - interval '30 days'
    and not exists (select 1 from public.dm_stars s where s.message_id = m.id);
$$;

-- -----------------------------------------------------------------------------
-- Funzioni
-- -----------------------------------------------------------------------------

-- La propria chiave (anche la parte cifrata, che agli altri non è leggibile).
create or replace function public.dm_my_key()
returns table (public_key text, wrapped_key text, salt text, iv text, iterations int)
language sql stable security definer
set search_path = ''
as $$
  select k.public_key, k.wrapped_key, k.salt, k.iv, k.iterations
  from public.dm_keys k where k.user_id = auth.uid() and public.is_member();
$$;

-- Crea o sostituisce la propria chiave (prima attivazione o codice perso).
create or replace function public.dm_set_key(
  p_public text, p_wrapped text, p_salt text, p_iv text, p_iterations int)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_member() then raise exception 'forbidden'; end if;
  insert into public.dm_keys (user_id, public_key, wrapped_key, salt, iv, iterations)
  values (auth.uid(), p_public, p_wrapped, p_salt, p_iv, p_iterations)
  on conflict (user_id) do update
    set public_key = excluded.public_key, wrapped_key = excluded.wrapped_key,
        salt = excluded.salt, iv = excluded.iv, iterations = excluded.iterations,
        updated_at = now();
end;
$$;

-- Invia un messaggio già cifrato. Limiti (per mittente):
--   5 messaggi ogni 5 s, 60 al minuto; al massimo 3 persone diverse ogni 2 minuti.
create or replace function public.dm_send(p_to uuid, p_body text, p_iv text, p_recipient_pub text)
returns public.dm_messages
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_spub text;
  v_rpub text;
  v_row  public.dm_messages;
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if p_to is null or p_to = v_me then raise exception 'dm_invalid_recipient'; end if;
  if not exists (select 1 from public.members where user_id = p_to) then
    raise exception 'dm_invalid_recipient';
  end if;

  select public_key into v_spub from public.dm_keys where user_id = v_me;
  if v_spub is null then raise exception 'dm_no_key'; end if;
  select public_key into v_rpub from public.dm_keys where user_id = p_to;
  if v_rpub is null then raise exception 'dm_recipient_no_key'; end if;
  if v_rpub is distinct from p_recipient_pub then raise exception 'dm_key_changed'; end if;

  -- un invio alla volta per mittente, così i conteggi sotto sono esatti
  perform pg_advisory_xact_lock(hashtextextended('dm:' || v_me::text, 0));

  if (select count(*) from public.dm_messages
      where sender = v_me and created_at > clock_timestamp() - interval '5 seconds') >= 5
  or (select count(*) from public.dm_messages
      where sender = v_me and created_at > clock_timestamp() - interval '1 minute') >= 60 then
    raise exception 'dm_rate_limited';
  end if;
  if (select count(distinct recipient) from public.dm_messages
      where sender = v_me and recipient <> p_to
        and created_at > clock_timestamp() - interval '2 minutes') >= 3 then
    raise exception 'dm_too_many_people';
  end if;

  insert into public.dm_messages (sender, recipient, sender_pub, recipient_pub, iv, body, created_at)
  values (v_me, p_to, v_spub, v_rpub, p_iv, p_body, clock_timestamp())
  returning * into v_row;

  perform private.dm_purge();
  return v_row;
end;
$$;

-- Mette o toglie la propria stellina. Senza stelline un messaggio scaduto sparisce subito.
create or replace function public.dm_star(p_id bigint, p_on boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  m    public.dm_messages;
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  select * into m from public.dm_messages where id = p_id;
  if m.id is null or not public.dm_visible(m.sender, m.recipient, m.created_at, m.id) then
    raise exception 'dm_not_found';
  end if;
  if p_on then
    insert into public.dm_stars (user_id, message_id) values (v_me, p_id) on conflict do nothing;
  else
    delete from public.dm_stars where user_id = v_me and message_id = p_id;
    perform private.dm_purge();
  end if;
end;
$$;

-- Elenco delle mie chat: con chi, ultimo messaggio (solo quelli che vedo).
create or replace function public.dm_conversations()
returns table (peer uuid, last_id bigint, last_at timestamptz, last_sender uuid)
language sql stable security invoker
set search_path = ''
as $$
  select distinct on (peer) peer, id, created_at, sender
  from (
    select case when m.sender = auth.uid() then m.recipient else m.sender end as peer,
           m.id, m.created_at, m.sender
    from public.dm_messages m
  ) t
  order by peer, id desc;
$$;

revoke execute on function private.dm_purge() from public, anon, authenticated;
revoke execute on function public.dm_my_key() from public, anon;
revoke execute on function public.dm_set_key(text, text, text, text, int) from public, anon;
revoke execute on function public.dm_send(uuid, text, text, text) from public, anon;
revoke execute on function public.dm_star(bigint, boolean) from public, anon;
revoke execute on function public.dm_conversations() from public, anon;
grant execute on function public.dm_my_key() to authenticated;
grant execute on function public.dm_set_key(text, text, text, text, int) to authenticated;
grant execute on function public.dm_send(uuid, text, text, text) to authenticated;
grant execute on function public.dm_star(bigint, boolean) to authenticated;
grant execute on function public.dm_conversations() to authenticated;

-- -----------------------------------------------------------------------------
-- RLS e permessi: lettura diretta limitata, scrittura solo tramite le funzioni.
-- -----------------------------------------------------------------------------
alter table public.dm_keys     enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_stars    enable row level security;

create policy dm_keys_select on public.dm_keys for select to authenticated
  using (public.is_member());
create policy dm_messages_select on public.dm_messages for select to authenticated
  using (public.is_member() and public.dm_visible(sender, recipient, created_at, id));
create policy dm_stars_select on public.dm_stars for select to authenticated
  using (user_id = auth.uid());

revoke all on public.dm_keys, public.dm_messages, public.dm_stars from anon, authenticated;
-- della tabella chiavi gli altri vedono solo la parte pubblica
grant select (user_id, public_key, updated_at) on public.dm_keys to authenticated;
grant select on public.dm_messages, public.dm_stars to authenticated;

-- I nuovi messaggi arrivano in tempo reale solo a mittente e destinatario (RLS).
alter publication supabase_realtime add table public.dm_messages;
