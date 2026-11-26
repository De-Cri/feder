// Chess between friends (0012_chess.sql): challenges, games, premoves and standings.
// The server keeps the moves and whose turn it is; the rules live in chess.ts.
import { supabase } from './supabase';
import { app } from './state.svelte';
import { notify } from './notify';
import { playSound, playChess } from './sounds';
import { t } from './i18n.svelte';
import { replay, findLegal, toUci, type Move } from './chess';

export type ChessGame = {
  id: number;
  white: string;
  black: string;
  challenger: string;
  status: 'pending' | 'active' | 'over' | 'declined' | 'cancelled';
  moves: string[];
  result: '1-0' | '0-1' | '1/2-1/2' | null;
  reason: 'checkmate' | 'resign' | 'stalemate' | 'agreed' | 'insufficient' | 'repetition' | 'fifty' | 'aborted' | 'timeout' | null;
  draw_offer: string | null;
  /** Clock (0013): seconds per player (null = no clock), seconds added per move, time left, when the clock to move started. */
  time_base: number | null;
  time_inc: number;
  white_ms: number | null;
  black_ms: number | null;
  last_move_at: string | null;
  created_at: string;
  updated_at: string;
};
export type Standing = { user_id: string; won: number; drawn: number; lost: number; points: number };

/** `app.view` of the chess page. */
export const CHESS_VIEW = -4;

const ERRORS = [
  'chess_not_friend', 'chess_already_pending', 'chess_too_many', 'chess_rate_limited',
  'chess_not_found', 'chess_not_active', 'chess_out_of_sync', 'chess_not_your_turn', 'chess_invalid_time',
] as const;
function errorText(e: { message: string } | null): string | null {
  if (!e) return null;
  const code = ERRORS.find((c) => e.message.includes(c));
  return code ? t(`chess.err.${code}` as const) : t('social.err.generic');
}

class Games {
  list = $state<ChessGame[]>([]);
  standings = $state<Standing[]>([]);
  /** The game shown on the board. */
  openId = $state<number | null>(null);
  /** Challenges shown as a popup (game ids), until answered or closed. */
  popups = $state<number[]>([]);
  /** Queued premoves per game (played in order as soon as it's your turn). */
  premoves = $state<Record<number, Move[]>>({});
  private sending = new Set<number>();
  /** Server clock minus local clock (ms). */
  private offset = 0;
  private loaded = false;

  get open(): ChessGame | null {
    return this.list.find((g) => g.id === this.openId) ?? null;
  }
  get incoming(): ChessGame[] {
    return this.list.filter((g) => g.status === 'pending' && g.challenger !== app.me);
  }
  get outgoing(): ChessGame[] {
    return this.list.filter((g) => g.status === 'pending' && g.challenger === app.me);
  }
  get active(): ChessGame[] {
    return this.list.filter((g) => g.status === 'active');
  }
  get finished(): ChessGame[] {
    return this.list.filter((g) => g.status === 'over').slice(0, 15);
  }
  opponent(g: ChessGame): string {
    return g.white === app.me ? g.black : g.white;
  }
  myColor(g: ChessGame): 'w' | 'b' {
    return g.white === app.me ? 'w' : 'b';
  }
  myTurn(g: ChessGame): boolean {
    return g.status === 'active' && (g.moves.length % 2 === 0) === (g.white === app.me);
  }
  /** Badge on the menu entry: challenges to answer + games waiting for your move. */
  get pending(): number {
    return this.incoming.length + this.active.filter((g) => this.myTurn(g)).length;
  }

  init() {
    app.onChessChange = (row) => this.upsert(row as ChessGame);
    void this.load();
  }
  stop() {
    app.onChessChange = null;
    this.list = [];
    this.standings = [];
    this.popups = [];
    this.premoves = {};
    this.openId = null;
    this.loaded = false;
  }

  async load() {
    if (!app.me) return;
    const sent = Date.now();
    const [{ data }, now] = await Promise.all([
      supabase.from('chess_games').select('*').order('updated_at', { ascending: false }).limit(60),
      supabase.rpc('server_now'),
    ]);
    if (now.data) this.offset = Date.parse(now.data as string) - (sent + Date.now()) / 2;
    this.list = (data ?? []) as ChessGame[];
    this.loaded = true;
    void this.loadStandings();
  }
  async loadStandings() {
    const { data } = await supabase.rpc('chess_standings');
    this.standings = (data ?? []) as Standing[];
  }

  /** A change from the server (realtime): notify what's new for you, then play queued premoves. */
  private upsert(row: ChessGame) {
    if (!row?.id || !this.loaded) return;
    const before = this.list.find((g) => g.id === row.id);
    // my own move still on its way: don't step back to the older row
    if (before && this.sending.has(row.id) && row.moves.length < before.moves.length && row.status === 'active') return;
    this.list = [row, ...this.list.filter((g) => g.id !== row.id)];
    const me = app.me;
    const opp = this.opponent(row);
    const away = !(app.focused && app.view === CHESS_VIEW && this.openId === row.id);

    if (!before && row.status === 'pending' && row.challenger !== me) {
      this.popups = [...this.popups.filter((id) => id !== row.id), row.id];
      playSound('poke');
      notify(t('chess.notifyChallenge', { name: app.name(opp) }), t('chess.notifyChallengeBody'));
    } else if (before?.status === 'pending' && row.status === 'active' && row.challenger === me) {
      notify(t('chess.notifyAccepted', { name: app.name(opp) }), '');
      playSound('message');
      if (this.openId === null) this.openId = row.id;
    } else if (before && row.moves.length > before.moves.length && (row.moves.length % 2 === 1) === (row.white !== me)) {
      // the opponent moved: just the move's sound, no notification
      this.moveSound(row.moves);
      if (row.status === 'over' && away) notify(t('chess.notifyOver', { name: app.name(opp) }), this.resultText(row));
    } else if (before?.status === 'active' && row.status === 'over') {
      if (row.reason === 'timeout' || row.reason === 'resign' || row.reason === 'agreed') playChess('end');
      if (away) notify(t('chess.notifyOver', { name: app.name(opp) }), this.resultText(row));
    } else if (row.draw_offer && row.draw_offer !== me && before?.draw_offer !== row.draw_offer && away) {
      notify(t('chess.notifyDraw', { name: app.name(opp) }), '');
    }
    if (row.status !== 'pending') this.popups = this.popups.filter((id) => id !== row.id);
    if (row.status !== 'active') delete this.premoves[row.id];
    if (row.status === 'over' && before?.status !== 'over') void this.loadStandings();
    this.runPremove(row.id);
  }

  /** Your turn and a premove waiting: play it if legal now, otherwise drop all of them. */
  private runPremove(id: number) {
    const g = this.list.find((x) => x.id === id);
    const queue = this.premoves[id];
    if (!g || !queue?.length || !this.myTurn(g) || this.sending.has(id)) return;
    const [first, ...rest] = queue;
    const game = replay(g.moves);
    const legal = findLegal(game.pos, { ...first, promo: first.promo });
    if (!legal) {
      delete this.premoves[id];
      return;
    }
    this.premoves[id] = rest;
    void this.move(g, legal);
  }

  addPremove(g: ChessGame, m: Move) {
    this.premoves[g.id] = [...(this.premoves[g.id] ?? []), m];
  }
  clearPremoves(g: ChessGame) {
    delete this.premoves[g.id];
  }

  /** Plays a legal move: shown right away, then sent. Returns an error message or null. */
  async move(g: ChessGame, m: Move): Promise<string | null> {
    const ply = g.moves.length;
    const moves = [...g.moves, toUci(m)];
    const end = replay(moves).ending;
    this.sending.add(g.id);
    // show my clock as the server will set it: time used, plus the increment
    const clock: Partial<ChessGame> = {};
    if (g.time_base !== null) {
      const white = this.myColor(g) === 'w';
      const left = Math.max(0, this.clock(g, white ? 'w' : 'b') ?? 0) + (ply >= 2 ? g.time_inc * 1000 : 0);
      Object.assign(clock, white ? { white_ms: left } : { black_ms: left }, { last_move_at: new Date(this.serverNow()).toISOString() });
    }
    this.list = this.list.map((x) => (x.id === g.id ? { ...x, ...clock, moves, draw_offer: null } : x));
    this.moveSound(moves);
    const { error } = await supabase.rpc('chess_move', { p_game: g.id, p_ply: ply, p_move: toUci(m), p_end: end });
    this.sending.delete(g.id);
    if (error) {
      delete this.premoves[g.id];
      await this.load();
      return errorText(error);
    }
    this.runPremove(g.id);
    return null;
  }

  /** Sound of the last move: check, capture or plain; two notes if it ended the game. */
  private moveSound(moves: string[]) {
    const r = replay(moves);
    const san = r.sans.at(-1) ?? '';
    if (r.ending) playChess(san.endsWith('#') ? 'check' : 'move');
    else playChess(san.includes('+') ? 'check' : san.includes('x') ? 'capture' : 'move');
    if (r.ending) setTimeout(() => playChess('end'), 250);
  }

  /** Server time now (ms), from the offset measured at load. */
  serverNow(): number {
    return Date.now() + this.offset;
  }
  /** Time left for a color (ms), or null without a clock. Runs only for the side to move, after both first moves. */
  clock(g: ChessGame, c: 'w' | 'b'): number | null {
    if (g.time_base === null) return null;
    const ms = (c === 'w' ? g.white_ms : g.black_ms) ?? g.time_base * 1000;
    const toMove = g.moves.length % 2 === 0 ? 'w' : 'b';
    if (g.status !== 'active' || toMove !== c || g.moves.length < 2 || !g.last_move_at) return ms;
    return ms - (this.serverNow() - Date.parse(g.last_move_at));
  }
  /** The side to move has run out: ask the server to end the game (once per position). */
  private flagged = new Set<string>();
  timeout(g: ChessGame) {
    const k = `${g.id}:${g.moves.length}`;
    if (this.flagged.has(k) || g.status !== 'active') return;
    this.flagged.add(k);
    // a little margin: the server must agree that the time is really over
    setTimeout(() => void supabase.rpc('chess_timeout', { p_game: g.id }).then(({ error }) => {
      // not over for the server yet (clocks a bit apart): try again in a moment
      if (error) setTimeout(() => this.flagged.delete(k), 1500);
    }), 300);
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<string | null> {
    const { error } = await supabase.rpc(fn, args);
    if (error) await this.load();
    return errorText(error);
  }

  async challenge(user: string, color: 'white' | 'black' | 'random', base: number | null, inc: number): Promise<string | null> {
    const { data, error } = await supabase.rpc('chess_challenge', { p_user: user, p_color: color, p_base: base, p_inc: inc });
    if (error) return errorText(error);
    await this.load();
    this.openId = data as number;
    return null;
  }
  async respond(g: ChessGame, accept: boolean): Promise<string | null> {
    this.popups = this.popups.filter((id) => id !== g.id);
    const err = await this.call('chess_respond', { p_game: g.id, p_accept: accept });
    if (!err && accept) {
      this.openId = g.id;
      app.view = CHESS_VIEW;
    }
    return err;
  }
  cancel(g: ChessGame) {
    return this.call('chess_cancel', { p_game: g.id });
  }
  resign(g: ChessGame) {
    return this.call('chess_resign', { p_game: g.id });
  }
  draw(g: ChessGame, on: boolean) {
    return this.call('chess_draw', { p_game: g.id, p_on: on });
  }
  closePopup(id: number) {
    this.popups = this.popups.filter((x) => x !== id);
  }

  /** "10 min", "3+2", or no clock. */
  controlLabel(base: number | null, inc: number): string {
    if (base === null) return t('chess.noClock');
    const min = base / 60;
    return inc ? `${min}+${inc}` : `${min} min`;
  }

  /** "You won by checkmate", "Draw by stalemate"… from your point of view. */
  resultText(g: ChessGame): string {
    if (g.reason === 'aborted') return t('chess.aborted');
    if (!g.result || !g.reason) return '';
    const how = t(`chess.reason.${g.reason}` as const);
    if (g.result === '1/2-1/2') return t('chess.drawBy', { how });
    const won = (g.result === '1-0') === (g.white === app.me);
    return t(won ? 'chess.wonBy' : 'chess.lostBy', { how });
  }
}

export const games = new Games();
