<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { social } from '../lib/social.svelte';
  import { games, type ChessGame } from '../lib/games.svelte';
  import { replay, inCheck } from '../lib/chess';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import ChessBoard from './ChessBoard.svelte';
  import { t } from '../lib/i18n.svelte';

  // Chess page: challenge a friend, your games, the standings, and the board.
  let picking = $state(false);
  let color = $state<'white' | 'random' | 'black'>('random');
  // time control: [seconds, increment], null = no clock
  const CONTROLS: ([number, number] | null)[] = [null, [60, 0], [180, 0], [180, 2], [300, 0], [600, 0], [900, 10], [1800, 0]];
  let control = $state(5);
  // ticks while a clock runs
  let now = $state(Date.now());
  let msg = $state<string | null>(null);
  let busy = $state(false);
  let confirmResign = $state(false);
  let ply = $state<number | null>(null);
  let areaW = $state(0);
  let areaH = $state(0);

  const game = $derived(games.open);
  const played = $derived(game ? replay(game.moves) : null);
  const opp = $derived(game ? games.opponent(game) : null);
  // watching a friends' game: white at the bottom, no buttons
  const spectating = $derived(!!game && !games.plays(game));
  const bottom = $derived<'w' | 'b'>(game && !spectating ? games.myColor(game) : 'w');
  const playerOf = (g: ChessGame, c: 'w' | 'b') => (c === 'w' ? g.white : g.black);
  const friends = $derived([...social.friends].sort((a, b) => app.name(a).localeCompare(app.name(b))));
  const waitingWith = $derived(new Set(games.list.filter((g) => g.status === 'pending').map((g) => games.opponent(g))));
  // the board fills the space left, in whole pixels per square
  const showMoves = $derived(areaW >= 640);
  const size = $derived(
    Math.max(240, Math.floor(Math.min(areaW - 32 - (showMoves ? 186 : 0), areaH - 24 - 2 * 44 - 56) / 8) * 8),
  );

  onMount(() => {
    void games.load();
    const onFocus = () => void games.load(); // anything missed while away (sleep, lost connection)
    window.addEventListener('focus', onFocus);
    const tick = setInterval(() => {
      if (!games.ticking.length) return;
      now = Date.now();
      // the side to move ran out of time: ask the server to end the game
      for (const g of games.active) {
        const left = games.clock(g, g.moves.length % 2 === 0 ? 'w' : 'b');
        if (left !== null && left <= 0) games.timeout(g);
      }
    }, 100);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(tick);
    };
  });

  // a new move or another game: back to the live position
  $effect(() => {
    void games.openId;
    void game?.moves.length;
    ply = null;
    confirmResign = false;
  });

  async function run(fn: () => Promise<string | null>) {
    busy = true;
    msg = await fn();
    busy = false;
    return msg;
  }
  async function challenge(id: string) {
    if (!(await run(() => games.challenge(id, color, CONTROLS[control]?.[0] ?? null, CONTROLS[control]?.[1] ?? 0)))) picking = false;
  }

  function status(g: ChessGame): string {
    const tc = games.controlLabel(g.time_base, g.time_inc);
    if (g.status === 'pending') return (g.challenger === app.me ? t('chess.waiting', { name: app.name(games.opponent(g)) }) : t('chess.challengedYou', { name: app.name(g.challenger) })) + ' · ' + tc;
    if (g.status === 'over') return games.resultText(g);
    const p = replay(g.moves);
    // the game just ended on the board: say so before the server confirms
    if (p.ending) return games.resultText({ ...g, reason: p.ending, result: p.ending === 'checkmate' ? (p.pos.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2' });
    const toMove = playerOf(g, g.moves.length % 2 === 0 ? 'w' : 'b');
    const turn = games.myTurn(g) ? t('chess.yourTurn') : t('chess.theirTurn', { name: app.name(games.plays(g) ? games.opponent(g) : toMove) });
    return inCheck(p.pos) ? `${turn} · ${t('chess.check')}` : turn;
  }

  function step(d: number) {
    if (!played) return;
    const cur = ply ?? played.played;
    const next = Math.min(played.played, Math.max(0, cur + d));
    ply = next >= played.played ? null : next;
  }
  function onKey(e: KeyboardEvent) {
    if (app.settingsOpen || (e.target as Element)?.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  }

  function clockText(g: ChessGame, c: 'w' | 'b'): { text: string; low: boolean; running: boolean } | null {
    void now;
    const ms = games.clock(g, c);
    if (ms === null) return null;
    const left = Math.max(0, ms);
    const s = left / 1000;
    const text = s < 10 ? s.toFixed(1) : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const running = g.status === 'active' && (g.moves.length % 2 === 0 ? 'w' : 'b') === c;
    return { text, low: s < 20, running };
  }

  const record = (id: string) => games.standings.find((s) => s.user_id === id);
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <header>
    <Icon name="chess" size={18} />
    <h2>{t('chess.title')}</h2>
    <button class="btn primary small challenge" onclick={() => ((picking = !picking), (msg = null))}>
      <Icon name="sword" size={14} /> {t('chess.challenge')}
    </button>
  </header>

  <div class="body">
    <aside class="list">
      {#if picking}
        <section class="picker">
          <h3>{t('chess.pickFriend')}</h3>
          <div class="seg" role="radiogroup" aria-label={t('chess.color')}>
            {#each [['white', t('chess.white')], ['random', t('chess.random')], ['black', t('chess.black')]] as [v, label]}
              <button role="radio" aria-checked={color === v} class:on={color === v} onclick={() => (color = v as typeof color)}>{label}</button>
            {/each}
          </div>
          <div class="seg times" role="radiogroup" aria-label={t('chess.time')}>
            {#each CONTROLS as c, i}
              <button role="radio" aria-checked={control === i} class:on={control === i} title={c ? '' : t('chess.noClock')} onclick={() => (control = i)}>{c ? games.controlLabel(c[0], c[1]) : '∞'}</button>
            {/each}
          </div>
          {#each friends as id (id)}
            <div class="row">
              <Avatar {id} size={26} status={app.presence[id] ? 'online' : 'offline'} />
              <span class="who">{app.name(id)}</span>
              <button class="btn small" disabled={busy || waitingWith.has(id)} onclick={() => challenge(id)}>
                {waitingWith.has(id) ? t('chess.sent') : t('chess.send')}
              </button>
            </div>
          {:else}
            <p class="muted">{t('chess.noFriends')}</p>
          {/each}
        </section>
      {/if}
      {#if msg}<p class="err">{msg}</p>{/if}

      {#each [[t('chess.incoming'), games.incoming], [t('chess.active'), games.active], [t('chess.outgoing'), games.outgoing]] as [label, list]}
        {#if (list as ChessGame[]).length}
          <h3>{label}</h3>
          {#each list as ChessGame[] as g (g.id)}
            {@render item(g)}
          {/each}
        {/if}
      {/each}

      {#if games.watchable.length}
        <h3>{t('chess.watch')}</h3>
        {#each games.watchable as g (g.id)}
          {@render watchItem(g)}
        {/each}
      {/if}

      <h3>{t('chess.standings')}</h3>
      <table class="standings">
        <thead>
          <tr><th></th><th class="l">{t('chess.player')}</th><th title={t('chess.wonLong')}>{t('chess.won')}</th><th title={t('chess.drawnLong')}>{t('chess.drawn')}</th><th title={t('chess.lostLong')}>{t('chess.lost')}</th><th title={t('chess.pointsLong')}>{t('chess.points')}</th></tr>
        </thead>
        <tbody>
          {#each games.standings as s, i (s.user_id)}
            <tr class:me={s.user_id === app.me}>
              <td class="pos">{i + 1}</td>
              <td class="l name">{app.name(s.user_id)}</td>
              <td>{s.won}</td><td>{s.drawn}</td><td>{s.lost}</td>
              <td class="pts">{s.points}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="hint">{t('chess.pointsHint')}</p>

      {#if games.finished.length}
        <h3>{t('chess.finished')}</h3>
        {#each games.finished as g (g.id)}
          {@render item(g)}
        {/each}
      {/if}
    </aside>

    <section class="play" bind:clientWidth={areaW} bind:clientHeight={areaH}>
      {#if game && played && opp}
        <div class="column" style="width:{size}px">
          {@render player(playerOf(game, bottom === 'w' ? 'b' : 'w'), bottom === 'w' ? 'b' : 'w')}
          <div class="row-board">
            <ChessBoard {game} {ply} {size} />
          </div>
          {@render player(playerOf(game, bottom), bottom)}

          <div class="controls">
            {#if spectating}<span class="watching" title={t('chess.watchingHint')}><Icon name="eye" size={13} /> {t('chess.watching')}</span>{/if}
            <span class="status">{status(game)}</span>
            {#if played.played < game.moves.length}<span class="err">{t('chess.badMove')}</span>{/if}
            <span class="grow"></span>
            {#if spectating}
              <!-- read only -->
            {:else if game.status === 'pending'}
              {#if game.challenger === app.me}
                <button class="btn small" disabled={busy} onclick={() => run(() => games.cancel(game))}>{t('common.cancel')}</button>
              {:else}
                <button class="btn primary small" disabled={busy} onclick={() => run(() => games.respond(game, true))}>{t('social.accept')}</button>
                <button class="btn small" disabled={busy} onclick={() => run(() => games.respond(game, false))}>{t('social.decline')}</button>
              {/if}
            {:else if game.status === 'active' && !played.ending}
              {#if game.draw_offer && game.draw_offer !== app.me}
                <span class="offer">{t('chess.drawOffered', { name: app.name(opp) })}</span>
                <button class="btn primary small" disabled={busy} onclick={() => run(() => games.draw(game, true))}>{t('social.accept')}</button>
                <button class="btn small" disabled={busy} onclick={() => run(() => games.draw(game, false))}>{t('social.decline')}</button>
              {:else if game.draw_offer && game.draw_offer === app.me}
                <button class="btn small" disabled={busy} onclick={() => run(() => games.draw(game, false))}>{t('chess.drawWithdraw')}</button>
              {:else if game.moves.length >= 2}
                <button class="btn small" disabled={busy} onclick={() => run(() => games.draw(game, true))}>{t('chess.drawOffer')}</button>
              {/if}
              {#if confirmResign}
                <button class="btn small danger" disabled={busy} onclick={() => run(() => games.resign(game))}>{t('chess.confirm')}</button>
              {:else}
                <button class="btn small" onclick={() => (confirmResign = true)}>{game.moves.length < 2 ? t('chess.abort') : t('chess.resign')}</button>
              {/if}
            {/if}
          </div>
        </div>

        {#if showMoves}
        <div class="moves">
          <div class="moves-head">
            <span>{t('chess.moves')}</span>
            <button class="icon-btn" title={t('chess.prev')} onclick={() => step(-1)}><Icon name="arrow-left" size={14} /></button>
            <button class="icon-btn flip" title={t('chess.next')} onclick={() => step(1)}><Icon name="arrow-left" size={14} /></button>
          </div>
          <ol>
            {#each Array(Math.ceil(played.sans.length / 2)) as _, i}
              <li>
                <span class="n">{i + 1}.</span>
                {#each [2 * i, 2 * i + 1] as k}
                  {#if played.sans[k]}
                    <button class="mv" class:cur={(ply ?? played.played) === k + 1} onclick={() => (ply = k + 1 >= played.played ? null : k + 1)}>{played.sans[k]}</button>
                  {/if}
                {/each}
              </li>
            {/each}
          </ol>
        </div>
        {/if}
      {:else}
        <div class="empty">
          <Icon name="chess" size={40} stroke={1.25} />
          <p>{t('chess.empty')}</p>
          <button class="btn primary" onclick={() => (picking = true)}>{t('chess.challenge')}</button>
        </div>
      {/if}
    </section>
  </div>
</div>

{#snippet item(g: ChessGame)}
  <button class="row game" class:active={games.openId === g.id} onclick={() => (games.openId = g.id)}>
    <Avatar id={games.opponent(g)} size={26} status={app.presence[games.opponent(g)] ? 'online' : 'offline'} />
    <span class="info">
      <span class="who">{app.name(games.opponent(g))}</span>
      <span class="sub" class:turn={games.myTurn(g) || (g.status === 'pending' && g.challenger !== app.me)}>{status(g)}</span>
    </span>
  </button>
{/snippet}

{#snippet watchItem(g: ChessGame)}
  <button class="row game" class:active={games.openId === g.id} onclick={() => (games.openId = g.id)}>
    <span class="pair">
      <Avatar id={g.white} size={22} />
      <Avatar id={g.black} size={22} />
    </span>
    <span class="info">
      <span class="who">{app.name(g.white)} <span class="vs">vs</span> {app.name(g.black)}</span>
      <span class="sub">{status(g)}</span>
    </span>
  </button>
{/snippet}

{#snippet player(id: string, c: 'w' | 'b')}
  {@const r = record(id)}
  {@const clk = game ? clockText(game, c) : null}
  <div class="player">
    <Avatar {id} size={28} status={app.presence[id] ? 'online' : 'offline'} />
    <span class="pname">{app.name(id)}</span>
    {#if r}<span class="prec">{r.points} {t('chess.points').toLowerCase()}</span>{/if}
    <span class="grow"></span>
    <span class="swatch" class:black={c === 'b'} title={c === 'w' ? t('chess.white') : t('chess.black')}></span>
    {#if clk}<span class="clock" class:running={clk.running} class:low={clk.low && clk.running}>{clk.text}</span>{/if}
  </div>
{/snippet}

<style>
  .page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  header {
    flex: none;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
  }
  h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .challenge { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
  .btn.small { height: 28px; padding: 0 12px; font-size: 12px; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr); }
  .list { overflow-y: auto; padding: 4px 12px 24px; border-right: 1px solid var(--border); }
  h3 {
    margin: 18px 6px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .picker { padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .seg { display: flex; margin: 0 6px 8px; border-radius: var(--r-sm); background: var(--bg-input); padding: 2px; }
  .seg button { flex: 1; height: 26px; font-size: 12px; border-radius: 3px; color: var(--text-2); }
  .seg button.on { background: var(--bg-elev); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15); }
  .row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 6px; border-radius: var(--r-sm); width: 100%; text-align: left; }
  .row:hover { background: var(--bg-hover); }
  .row.game.active { background: var(--bg-active); }
  .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .sub { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub.turn { color: var(--text); font-weight: 600; }
  .muted, .hint { margin: 4px 6px; font-size: 12px; color: var(--text-3); }
  .err { margin: 6px; font-size: 12px; color: var(--red); }

  .standings { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
  .standings th { font-weight: 600; color: var(--text-3); padding: 4px 4px; text-align: center; }
  .standings td { padding: 5px 4px; text-align: center; border-top: 1px solid var(--border); }
  .standings .l { text-align: left; }
  .standings .pos { color: var(--text-3); width: 18px; }
  .standings .name { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .standings .pts { font-weight: 700; }
  .standings tr.me td { background: var(--bg-hover); }

  .play { min-width: 0; min-height: 0; overflow: hidden; display: flex; justify-content: center; align-items: center; gap: 16px; padding: 12px 16px; }
  .column { display: flex; flex-direction: column; flex: none; }
  .row-board { display: flex; }
  .player { height: 44px; display: flex; align-items: center; gap: 8px; }
  .pname { font-size: 14px; font-weight: 600; }
  .prec { font-size: 12px; color: var(--text-3); }
  .grow { flex: 1; }
  .swatch { width: 14px; height: 14px; border-radius: 3px; background: #f4f4f4; box-shadow: 0 0 0 1px var(--border-strong); }
  .swatch.black { background: #262626; }
  .clock {
    min-width: 76px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    background: var(--bg-input);
    color: var(--text-3);
    font: 600 18px/1.2 var(--mono);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .clock.running { background: #f4f4f4; color: #1c1c1c; box-shadow: 0 0 0 1px var(--border-strong); }
  .clock.low { background: var(--red); color: #fff; box-shadow: none; }
  .seg.times { flex-wrap: wrap; }
  .seg.times button { flex: 1 0 22%; }
  .controls { min-height: 56px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status { font-size: 13px; font-weight: 600; }
  .watching {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border-radius: 11px;
    background: var(--bg-input);
    color: var(--text-2);
    font-size: 11px;
    font-weight: 600;
  }
  .pair { display: flex; flex: none; }
  .pair { width: 36px; }
  .pair > :global(.av:last-child) { margin-left: -8px; box-shadow: 0 0 0 2px var(--bg); border-radius: 50%; }
  .vs { color: var(--text-3); font-weight: 400; font-size: 11px; }
  .offer { font-size: 12px; color: var(--text-2); }
  .danger { background: var(--red); color: #fff; }

  .moves { width: 170px; align-self: stretch; max-height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .moves-head { display: flex; align-items: center; gap: 2px; height: 44px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  .moves-head span { flex: 1; }
  .flip { transform: scaleX(-1); }
  ol { list-style: none; margin: 0; padding: 0; overflow-y: auto; font-size: 13px; font-variant-numeric: tabular-nums; }
  li { display: grid; grid-template-columns: 28px 1fr 1fr; align-items: center; height: 26px; }
  li:nth-child(odd) { background: var(--bg-hover); }
  .n { color: var(--text-3); padding-left: 4px; }
  .mv { text-align: left; padding: 2px 6px; border-radius: 3px; font-weight: 500; }
  .mv:hover { background: var(--bg-active); }
  .mv.cur { background: var(--bg-active); font-weight: 700; }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-3); }
  .empty p { margin: 0; font-size: 14px; }

</style>
