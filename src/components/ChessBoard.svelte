<script lang="ts">
  import { games, type ChessGame } from '../lib/games.svelte';
  import {
    replay, legalMoves, premoveTargets, playLoose, inCheck, kingSquare, fromUci, rank,
    type Kind, type Move, type Position,
  } from '../lib/chess';
  import ChessPiece from './ChessPiece.svelte';

  // The board: click or drag to move; on the opponent's turn the same gestures queue
  // premoves (right click clears them). `ply` shows an earlier position (read only).
  let { game, ply = null, size }: { game: ChessGame; ply?: number | null; size: number } = $props();

  const me = $derived(games.myColor(game));
  const flipped = $derived(me === 'b');
  const played = $derived(replay(game.moves));
  const live = $derived(ply === null || ply >= played.played);
  const canPlay = $derived(live && game.status === 'active' && !played.ending);
  const myTurn = $derived(canPlay && played.pos.turn === me);
  const queue = $derived(games.premoves[game.id] ?? []);

  // what's on the board: an earlier position, or now + the premoves you queued
  const shown = $derived.by((): Position => {
    if (!live) return played.history[ply!];
    let p = played.pos;
    for (const m of queue) p = playLoose(p, m);
    return p;
  });
  const lastMove = $derived.by(() => {
    const n = live ? played.played : ply!;
    return n > 0 ? fromUci(game.moves[n - 1]) : null;
  });
  const checked = $derived.by(() => {
    const p = live ? played.pos : played.history[ply!];
    return inCheck(p) ? kingSquare(p, p.turn) : -1;
  });
  const premoveSquares = $derived(new Set(queue.flatMap((m) => [m.from, m.to])));

  let selected = $state<number | null>(null);
  let drag = $state<{ from: number; x: number; y: number; moved: boolean } | null>(null);
  let promo = $state<{ from: number; to: number } | null>(null);
  let boardEl = $state<HTMLDivElement>();
  let wasSelected = false;

  const targets = $derived.by((): Set<number> => {
    if (selected === null || !canPlay) return new Set();
    if (myTurn && !queue.length) return new Set(legalMoves(played.pos).filter((m) => m.from === selected).map((m) => m.to));
    return new Set(premoveTargets(shown, selected));
  });

  // display order: a8..h1 for white, h1..a8 for black
  const order = $derived.by(() => {
    const out: number[] = [];
    for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) out.push(r * 8 + f);
    return flipped ? out.reverse() : out;
  });

  function squareAt(x: number, y: number): number {
    const rect = boardEl!.getBoundingClientRect();
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return flipped ? row * 8 + (7 - col) : (7 - row) * 8 + col;
  }
  const mine = (sq: number) => shown.board[sq]?.c === me;

  function tryMove(from: number, to: number) {
    selected = null;
    const piece = shown.board[from];
    if (!piece) return;
    const promotes = piece.k === 'p' && (rank(to) === 7 || rank(to) === 0);
    if (myTurn && !queue.length) {
      const legal = legalMoves(played.pos).filter((m) => m.from === from && m.to === to);
      if (!legal.length) return;
      if (promotes) promo = { from, to };
      else void games.move(game, legal[0]);
    } else {
      games.addPremove(game, { from, to, promo: promotes ? 'q' : undefined });
    }
  }

  function choosePromo(k: Kind) {
    const p = promo!;
    promo = null;
    const m: Move = { from: p.from, to: p.to, promo: k };
    if (legalMoves(played.pos).some((l) => l.from === m.from && l.to === m.to && l.promo === k)) void games.move(game, m);
  }

  function down(e: PointerEvent) {
    if (!canPlay) return;
    if (promo) {
      promo = null; // clicked outside the picker: no promotion
      return;
    }
    if (e.button === 2) {
      selected = null;
      games.clearPremoves(game);
      return;
    }
    if (e.button !== 0) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq < 0) return;
    if (selected !== null && targets.has(sq) && !mine(sq)) {
      tryMove(selected, sq);
      return;
    }
    if (mine(sq)) {
      wasSelected = selected === sq;
      selected = sq;
      drag = { from: sq, x: e.clientX, y: e.clientY, moved: false };
      boardEl!.setPointerCapture(e.pointerId);
    } else {
      selected = null;
    }
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    drag = { ...drag, x: e.clientX, y: e.clientY, moved: drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3 };
  }
  function up(e: PointerEvent) {
    if (!drag) return;
    const from = drag.from;
    drag = null;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq === from) {
      if (wasSelected) selected = null; // second click on the same piece
      return;
    }
    if (sq >= 0 && targets.has(sq)) tryMove(from, sq);
    else selected = null;
  }

  // a new position (opponent moved, game changed): forget a half-made move
  $effect(() => {
    void game.moves.length;
    void game.id;
    promo = null;
  });

  const cell = $derived(size / 8);
  const files = 'abcdefgh';
  function dragStyle() {
    const rect = boardEl!.getBoundingClientRect();
    return `width:${cell}px;height:${cell}px;left:${drag!.x - rect.left - cell / 2}px;top:${drag!.y - rect.top - cell / 2}px`;
  }
</script>

<div
  class="board"
  bind:this={boardEl}
  style="width:{size}px;height:{size}px"
  role="grid"
  tabindex="-1"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each order as sq, i (sq)}
    {@const light = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1}
    {@const piece = shown.board[sq]}
    <div
      class="sq"
      class:light
      class:last={lastMove && (lastMove.from === sq || lastMove.to === sq)}
      class:sel={selected === sq}
      class:pre={live && premoveSquares.has(sq)}
      class:check={checked === sq}
    >
      {#if i % 8 === 0}<span class="coord rank">{Math.floor(sq / 8) + 1}</span>{/if}
      {#if i >= 56}<span class="coord file">{files[sq % 8]}</span>{/if}
      {#if piece && !(drag?.moved && drag.from === sq)}
        <div class="piece"><ChessPiece c={piece.c} k={piece.k} /></div>
      {/if}
      {#if targets.has(sq)}<span class="dot" class:ring={!!piece}></span>{/if}
    </div>
  {/each}

  {#if drag?.moved && shown.board[drag.from]}
    {@const p = shown.board[drag.from]!}
    <div class="ghost" style={dragStyle()}><ChessPiece c={p.c} k={p.k} /></div>
  {/if}

  {#if promo}
    {@const col = flipped ? 7 - (promo.to % 8) : promo.to % 8}
    <div class="promo" style="left:{col * cell}px;width:{cell}px">
      {#each ['q', 'r', 'b', 'n'] as const as k}
        <button style="height:{cell}px" onpointerdown={(e) => e.stopPropagation()} onclick={() => choosePromo(k)}>
          <ChessPiece c={me} {k} />
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .board {
    --sq-light: #e3e3e3;
    --sq-dark: #9c9c9c;
    position: relative;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: repeat(8, 1fr);
    border-radius: var(--r-sm);
    overflow: hidden;
    /* a thin frame keeps the board apart from Feder's background in every theme */
    box-shadow: 0 0 0 1px var(--border-strong), 0 6px 18px rgba(0, 0, 0, 0.18);
    user-select: none;
    touch-action: none;
    flex: none;
  }
  .sq { position: relative; background: var(--sq-dark); }
  .sq.light { background: var(--sq-light); }
  .sq.last::before, .sq.sel::before, .sq.pre::before, .sq.check::before {
    content: '';
    position: absolute;
    inset: 0;
  }
  .sq.last::before { background: rgba(40, 40, 40, 0.2); }
  .sq.sel::before { background: rgba(40, 40, 40, 0.32); }
  .sq.pre::before { background: rgba(218, 55, 60, 0.45); }
  .sq.check::before { background: radial-gradient(circle, rgba(218, 55, 60, 0.9) 0%, rgba(218, 55, 60, 0.45) 45%, transparent 72%); }
  .piece { position: absolute; inset: 4%; cursor: grab; }
  .ghost { position: absolute; z-index: 3; pointer-events: none; padding: 0.5%; }
  .dot {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 30%;
    height: 30%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: rgba(30, 30, 30, 0.28);
    pointer-events: none;
  }
  .dot.ring { width: 92%; height: 92%; background: none; border: 5px solid rgba(30, 30, 30, 0.28); }
  .coord {
    position: absolute;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    pointer-events: none;
    color: var(--sq-dark);
  }
  .sq:not(.light) .coord { color: var(--sq-light); }
  .rank { top: 3px; left: 3px; }
  .file { bottom: 3px; right: 4px; }
  .promo {
    position: absolute;
    top: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    background: #f4f4f4;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  }
  .promo button { padding: 6%; border-radius: 0; }
  .promo button:hover { background: #dadada; }
</style>
