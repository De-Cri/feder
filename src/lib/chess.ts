// Chess rules: legal moves, check, castling, en passant, promotion and the automatic
// endings (mate, stalemate, insufficient material, threefold repetition, 50 moves).
// Squares are 0..63: index = rank * 8 + file, a1 = 0, h8 = 63. Moves are UCI (e2e4, e7e8q).

export type Color = 'w' | 'b';
export type Kind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Piece = { c: Color; k: Kind };
export type Move = { from: number; to: number; promo?: Kind };
export type Position = {
  board: (Piece | null)[];
  turn: Color;
  /** Castling rights: K Q (white), k q (black). */
  castle: { K: boolean; Q: boolean; k: boolean; q: boolean };
  /** Square a pawn can capture en passant on, or -1. */
  ep: number;
  /** Half-moves since the last capture or pawn move (50-move rule). */
  half: number;
};
export type Ending = 'checkmate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty';

export const file = (sq: number) => sq & 7;
export const rank = (sq: number) => sq >> 3;
export const sqName = (sq: number) => 'abcdefgh'[file(sq)] + (rank(sq) + 1);
export const sqIndex = (s: string) => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function toUci(m: Move): string {
  return sqName(m.from) + sqName(m.to) + (m.promo ?? '');
}
export function fromUci(s: string): Move | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s)) return null;
  return { from: sqIndex(s.slice(0, 2)), to: sqIndex(s.slice(2, 4)), promo: (s[4] as Kind) || undefined };
}

export function initial(): Position {
  const board: (Piece | null)[] = Array(64).fill(null);
  const back: Kind[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[f] = { c: 'w', k: back[f] };
    board[8 + f] = { c: 'w', k: 'p' };
    board[48 + f] = { c: 'b', k: 'p' };
    board[56 + f] = { c: 'b', k: back[f] };
  }
  return { board, turn: 'w', castle: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0 };
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** The square (df, dr) away from sq, or -1 off the board. */
function step(sq: number, df: number, dr: number): number {
  const f = file(sq) + df, r = rank(sq) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}

/** Is sq attacked by a piece of color `by`? */
export function attacked(pos: Position, sq: number, by: Color): boolean {
  const b = pos.board;
  const is = (s: number, ...kinds: Kind[]) => s >= 0 && b[s]?.c === by && kinds.includes(b[s]!.k);
  const pawnDir = by === 'w' ? -1 : 1; // attacker sits one rank "behind" sq
  if (is(step(sq, -1, pawnDir), 'p') || is(step(sq, 1, pawnDir), 'p')) return true;
  for (const [df, dr] of KNIGHT) if (is(step(sq, df, dr), 'n')) return true;
  for (const [df, dr] of KING) if (is(step(sq, df, dr), 'k')) return true;
  for (const [dirs, kinds] of [[ROOK, ['r', 'q']], [BISHOP, ['b', 'q']]] as const) {
    for (const [df, dr] of dirs) {
      let s = step(sq, df, dr);
      while (s >= 0) {
        if (b[s]) {
          if (b[s]!.c === by && (kinds as readonly Kind[]).includes(b[s]!.k)) return true;
          break;
        }
        s = step(s, df, dr);
      }
    }
  }
  return false;
}

export function kingSquare(pos: Position, c: Color): number {
  return pos.board.findIndex((p) => p?.c === c && p.k === 'k');
}
export function inCheck(pos: Position, c: Color = pos.turn): boolean {
  const k = kingSquare(pos, c);
  return k >= 0 && attacked(pos, k, other(c));
}

/** Moves that follow the pieces' rules, ignoring whether your king is left in check. */
function pseudo(pos: Position): Move[] {
  const out: Move[] = [];
  const b = pos.board, me = pos.turn;
  const add = (from: number, to: number) => {
    if (b[from]!.k === 'p' && (rank(to) === 7 || rank(to) === 0)) {
      for (const k of ['q', 'r', 'b', 'n'] as Kind[]) out.push({ from, to, promo: k });
    } else out.push({ from, to });
  };
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || p.c !== me) continue;
    if (p.k === 'p') {
      const dir = me === 'w' ? 1 : -1;
      const one = step(sq, 0, dir);
      if (one >= 0 && !b[one]) {
        add(sq, one);
        const startRank = me === 'w' ? 1 : 6;
        const two = step(sq, 0, 2 * dir);
        if (rank(sq) === startRank && !b[two]) add(sq, two);
      }
      for (const df of [-1, 1]) {
        const t = step(sq, df, dir);
        if (t < 0) continue;
        if ((b[t] && b[t]!.c !== me) || t === pos.ep) add(sq, t);
      }
    } else if (p.k === 'n' || p.k === 'k') {
      for (const [df, dr] of p.k === 'n' ? KNIGHT : KING) {
        const t = step(sq, df, dr);
        if (t >= 0 && b[t]?.c !== me) add(sq, t);
      }
    } else {
      const dirs = p.k === 'r' ? ROOK : p.k === 'b' ? BISHOP : [...ROOK, ...BISHOP];
      for (const [df, dr] of dirs) {
        let t = step(sq, df, dr);
        while (t >= 0) {
          if (b[t]) {
            if (b[t]!.c !== me) add(sq, t);
            break;
          }
          add(sq, t);
          t = step(t, df, dr);
        }
      }
    }
  }
  // Castling: rights, empty squares between, king not in check and not passing through check.
  const home = me === 'w' ? 4 : 60;
  if (b[home]?.k === 'k' && b[home]?.c === me && !attacked(pos, home, other(me))) {
    const [kRight, qRight] = me === 'w' ? [pos.castle.K, pos.castle.Q] : [pos.castle.k, pos.castle.q];
    const rook = (s: number) => b[s]?.k === 'r' && b[s]?.c === me;
    if (kRight && rook(home + 3) && !b[home + 1] && !b[home + 2]
      && !attacked(pos, home + 1, other(me)) && !attacked(pos, home + 2, other(me))) out.push({ from: home, to: home + 2 });
    if (qRight && rook(home - 4) && !b[home - 1] && !b[home - 2] && !b[home - 3]
      && !attacked(pos, home - 1, other(me)) && !attacked(pos, home - 2, other(me))) out.push({ from: home, to: home - 2 });
  }
  return out;
}

/** Plays a move (assumed legal) and returns the new position. */
export function play(pos: Position, m: Move): Position {
  const board = pos.board.slice();
  const p = board[m.from]!;
  const castle = { ...pos.castle };
  let ep = -1;
  const capture = !!board[m.to] || (p.k === 'p' && m.to === pos.ep);
  if (p.k === 'p' && m.to === pos.ep) board[m.to + (p.c === 'w' ? -8 : 8)] = null; // en passant
  if (p.k === 'p' && Math.abs(m.to - m.from) === 16) ep = (m.from + m.to) / 2;
  if (p.k === 'k' && Math.abs(m.to - m.from) === 2) {
    // castling: move the rook too
    const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
    board[rt] = board[rf];
    board[rf] = null;
  }
  board[m.to] = p.k === 'p' && m.promo ? { c: p.c, k: m.promo } : p;
  board[m.from] = null;
  if (p.k === 'k') {
    if (p.c === 'w') castle.K = castle.Q = false;
    else castle.k = castle.q = false;
  }
  for (const s of [m.from, m.to]) {
    if (s === 0) castle.Q = false;
    if (s === 7) castle.K = false;
    if (s === 56) castle.q = false;
    if (s === 63) castle.k = false;
  }
  return { board, turn: other(pos.turn), castle, ep, half: capture || p.k === 'p' ? 0 : pos.half + 1 };
}

export function legalMoves(pos: Position): Move[] {
  return pseudo(pos).filter((m) => !inCheck(play(pos, m), pos.turn));
}

/** The legal move matching from/to/promo, or null. */
export function findLegal(pos: Position, m: Move): Move | null {
  return legalMoves(pos).find((l) => l.from === m.from && l.to === m.to && (l.promo ?? null) === (m.promo ?? null)) ?? null;
}

function insufficient(pos: Position): boolean {
  const minors: { k: Kind; sq: number }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (!p || p.k === 'k') continue;
    if (p.k !== 'n' && p.k !== 'b') return false;
    minors.push({ k: p.k, sq });
  }
  if (minors.length <= 1) return true; // K vs K, K+minor vs K
  // only bishops, all on squares of the same color
  if (minors.every((m) => m.k === 'b')) {
    const shade = (sq: number) => (file(sq) + rank(sq)) % 2;
    return minors.every((m) => shade(m.sq) === shade(minors[0].sq));
  }
  return false;
}

/** Key for repetition: pieces, side to move, castling, en passant only if it can be taken. */
function key(pos: Position): string {
  let s = '';
  for (const p of pos.board) s += p ? (p.c === 'w' ? p.k.toUpperCase() : p.k) : '.';
  const ep = pos.ep >= 0 && legalMoves(pos).some((m) => m.to === pos.ep && pos.board[m.from]?.k === 'p') ? pos.ep : -1;
  const c = pos.castle;
  return `${s}${pos.turn}${+c.K}${+c.Q}${+c.k}${+c.q}${ep}`;
}

/** Standard notation of a legal move in pos (Nf3, exd5, O-O, e8=Q+, Qh4#). */
export function san(pos: Position, m: Move): string {
  const p = pos.board[m.from]!;
  let s: string;
  if (p.k === 'k' && Math.abs(m.to - m.from) === 2) s = m.to > m.from ? 'O-O' : 'O-O-O';
  else {
    const capture = !!pos.board[m.to] || (p.k === 'p' && m.to === pos.ep);
    if (p.k === 'p') {
      s = (capture ? 'abcdefgh'[file(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    } else {
      const rivals = legalMoves(pos).filter((l) => l.to === m.to && l.from !== m.from && pos.board[l.from]?.k === p.k);
      let dis = '';
      if (rivals.length) {
        if (!rivals.some((r) => file(r.from) === file(m.from))) dis = 'abcdefgh'[file(m.from)];
        else if (!rivals.some((r) => rank(r.from) === rank(m.from))) dis = String(rank(m.from) + 1);
        else dis = sqName(m.from);
      }
      s = p.k.toUpperCase() + dis + (capture ? 'x' : '') + sqName(m.to);
    }
  }
  const next = play(pos, m);
  if (inCheck(next)) s += legalMoves(next).length ? '+' : '#';
  return s;
}

export type Game = {
  pos: Position;
  /** Positions after each move (index 0 = start): to step back through the game. */
  history: Position[];
  sans: string[];
  /** How many of the given moves were legal and got played. */
  played: number;
  ending: Ending | null;
};

/** Replays a game from its UCI moves; stops at the first illegal one. */
export function replay(moves: string[]): Game {
  let pos = initial();
  const history = [pos];
  const sans: string[] = [];
  const seen = new Map<string, number>([[key(pos), 1]]);
  let repetition = false;
  let played = 0;
  for (const u of moves) {
    const parsed = fromUci(u);
    const m = parsed && findLegal(pos, parsed);
    if (!m) break;
    sans.push(san(pos, m));
    pos = play(pos, m);
    history.push(pos);
    played++;
    const k = key(pos);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    repetition = n >= 3;
  }
  return { pos, history, sans, played, ending: ending(pos, repetition) };
}

export function ending(pos: Position, repetition = false): Ending | null {
  if (!legalMoves(pos).length) return inCheck(pos) ? 'checkmate' : 'stalemate';
  if (insufficient(pos)) return 'insufficient';
  if (repetition) return 'repetition';
  if (pos.half >= 100) return 'fifty';
  return null;
}

/**
 * Squares a piece could reach on a later turn, ignoring the other pieces (for premoves,
 * like chess.com): the real check happens when the premove is played.
 */
export function premoveTargets(pos: Position, from: number): number[] {
  const p = pos.board[from];
  if (!p) return [];
  const out = new Set<number>();
  if (p.k === 'p') {
    const dir = p.c === 'w' ? 1 : -1;
    const one = step(from, 0, dir);
    if (one >= 0) out.add(one);
    if (rank(from) === (p.c === 'w' ? 1 : 6)) out.add(step(from, 0, 2 * dir));
    for (const df of [-1, 1]) {
      const t = step(from, df, dir);
      if (t >= 0) out.add(t);
    }
  } else if (p.k === 'n' || p.k === 'k') {
    for (const [df, dr] of p.k === 'n' ? KNIGHT : KING) {
      const t = step(from, df, dr);
      if (t >= 0) out.add(t);
    }
    if (p.k === 'k' && from === (p.c === 'w' ? 4 : 60)) {
      const c = pos.castle;
      if (p.c === 'w' ? c.K : c.k) out.add(from + 2);
      if (p.c === 'w' ? c.Q : c.q) out.add(from - 2);
    }
  } else {
    const dirs = p.k === 'r' ? ROOK : p.k === 'b' ? BISHOP : [...ROOK, ...BISHOP];
    for (const [df, dr] of dirs) for (let t = step(from, df, dr); t >= 0; t = step(t, df, dr)) out.add(t);
  }
  // never onto your own king
  return [...out].filter((t) => !(pos.board[t]?.c === p.c && pos.board[t]?.k === 'k'));
}

/** Shows a premove on the board: just moves the piece (queen on promotion), castling with the rook. */
export function playLoose(pos: Position, m: Move): Position {
  const board = pos.board.slice();
  const p = board[m.from];
  if (!p) return pos;
  if (p.k === 'k' && Math.abs(m.to - m.from) === 2 && rank(m.from) === rank(m.to)) {
    const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
    if (board[rf]?.k === 'r') {
      board[rt] = board[rf];
      board[rf] = null;
    }
  }
  board[m.to] = p.k === 'p' && (rank(m.to) === 7 || rank(m.to) === 0) ? { c: p.c, k: m.promo ?? 'q' } : p;
  board[m.from] = null;
  return { ...pos, board };
}
