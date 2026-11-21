// Friends, chat invites and private chats (0008_private_chats.sql).
// Everything is decided on the server: here we only load, show and call the functions.
import { supabase } from './supabase';
import { app } from './state.svelte';
import { notify } from './notify';
import { playSound } from './sounds';
import { t } from './i18n.svelte';

export type Friendship = {
  user_lo: string;
  user_hi: string;
  status: 'pending' | 'accepted';
  requested_by: string;
  created_at: string;
};
export type Invite = {
  id: number;
  channel_id: number;
  channel_name: string;
  kind: 'text' | 'voice';
  inviter: string;
  invitee: string;
  created_at: string;
};
export type ChatMember = { channel_id: number; user_id: string; role: 'owner' | 'member' };

/** `app.view` of the friends & invites page. */
export const FRIENDS_VIEW = -3;

/** Server error codes → message key (anything else is a generic error). */
const ERRORS = [
  'friend_invalid_user', 'friend_blocked', 'friend_rate_limited', 'friend_no_request',
  'chat_not_friend', 'chat_already_member', 'chat_full', 'chat_too_many', 'chat_rate_limited',
  'chat_invalid_name', 'chat_not_owner', 'invite_not_found',
] as const;

export function errorText(e: { message: string } | null): string | null {
  if (!e) return null;
  const code = ERRORS.find((c) => e.message.includes(c));
  return code ? t(`social.err.${code}` as const) : t('social.err.generic');
}

class Social {
  friendships = $state<Friendship[]>([]);
  invites = $state<Invite[]>([]);
  blocked = $state<string[]>([]);
  /** Members of the private chats I'm in (channel id → members). */
  chatMembers = $state<Record<number, ChatMember[]>>({});
  private loaded = false;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  private other(f: Friendship): string {
    return f.user_lo === app.me ? f.user_hi : f.user_lo;
  }
  get friends(): string[] {
    return this.friendships.filter((f) => f.status === 'accepted').map((f) => this.other(f));
  }
  get incomingRequests(): string[] {
    return this.friendships.filter((f) => f.status === 'pending' && f.requested_by !== app.me).map((f) => this.other(f));
  }
  get outgoingRequests(): string[] {
    return this.friendships.filter((f) => f.status === 'pending' && f.requested_by === app.me).map((f) => this.other(f));
  }
  get incomingInvites(): Invite[] {
    return this.invites.filter((i) => i.invitee === app.me);
  }
  get outgoingInvites(): Invite[] {
    return this.invites.filter((i) => i.inviter === app.me);
  }
  /** Badge on the friends page: things waiting for you. */
  get pending(): number {
    return this.incomingRequests.length + this.incomingInvites.length;
  }
  isFriend(id: string): boolean {
    return this.friendships.some((f) => f.status === 'accepted' && this.other(f) === id);
  }
  relation(id: string): 'friend' | 'incoming' | 'outgoing' | 'none' {
    const f = this.friendships.find((f) => this.other(f) === id);
    if (!f) return 'none';
    if (f.status === 'accepted') return 'friend';
    return f.requested_by === app.me ? 'outgoing' : 'incoming';
  }
  isOwner(channelId: number): boolean {
    return (this.chatMembers[channelId] ?? []).some((m) => m.user_id === app.me && m.role === 'owner');
  }

  init() {
    app.onSocialChange = () => this.reload();
    void this.load();
  }

  async load() {
    if (!app.me) return;
    const [fr, inv, bl, cm] = await Promise.all([
      supabase.from('friendships').select('*'),
      supabase.rpc('my_invites'),
      supabase.from('blocks').select('blocked'),
      supabase.from('channel_members').select('channel_id, user_id, role'),
    ]);
    const before = new Set([...this.incomingRequests.map((id) => 'f' + id), ...this.incomingInvites.map((i) => 'i' + i.id)]);
    this.friendships = (fr.data ?? []) as Friendship[];
    this.invites = (inv.data ?? []) as Invite[];
    this.blocked = ((bl.data ?? []) as { blocked: string }[]).map((r) => r.blocked);
    const members: Record<number, ChatMember[]> = {};
    for (const m of (cm.data ?? []) as ChatMember[]) (members[m.channel_id] ??= []).push(m);
    this.chatMembers = members;
    // something new for you since the last load (not on the first one)
    if (this.loaded) {
      for (const id of this.incomingRequests)
        if (!before.has('f' + id)) {
          notify(t('social.notifyRequest', { name: app.name(id) }), '');
          playSound('message');
        }
      for (const i of this.incomingInvites)
        if (!before.has('i' + i.id)) {
          notify(t('social.notifyInvite', { name: app.name(i.inviter), chat: i.channel_name }), '');
          playSound('message');
        }
    }
    this.loaded = true;
  }

  /** Many changes arrive together (e.g. creating a chat with 5 invites): one reload. */
  reload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.load(), 150);
  }

  stop() {
    app.onSocialChange = null;
    clearTimeout(this.reloadTimer);
    this.friendships = [];
    this.invites = [];
    this.blocked = [];
    this.chatMembers = {};
    this.loaded = false;
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<string | null> {
    const { error } = await supabase.rpc(fn, args);
    this.reload();
    return errorText(error);
  }

  /** Adds by username. Returns an error message or null. */
  async requestByName(username: string): Promise<string | null> {
    const name = username.trim().toLowerCase().replace(/^@/, '');
    const id = Object.values(app.profiles).find((p) => p.username === name)?.id;
    if (!id) return t('social.err.friend_invalid_user');
    return this.request(id);
  }
  request(id: string) {
    return this.call('friend_request', { p_user: id });
  }
  respond(id: string, accept: boolean) {
    return this.call('friend_respond', { p_user: id, p_accept: accept });
  }
  remove(id: string) {
    return this.call('friend_remove', { p_user: id });
  }
  block(id: string, on: boolean) {
    return this.call('user_block', { p_user: id, p_on: on });
  }

  async createChat(name: string, kind: 'text' | 'voice', invitees: string[]): Promise<{ id?: number; error: string | null }> {
    const { data, error } = await supabase.rpc('chat_create', { p_name: name, p_kind: kind, p_invitees: invitees });
    if (error) return { error: errorText(error) };
    await app.reloadChannels();
    await this.load();
    return { id: data as number, error: null };
  }
  invite(channelId: number, id: string) {
    return this.call('chat_invite', { p_channel: channelId, p_user: id });
  }
  async respondInvite(invite: Invite, accept: boolean): Promise<string | null> {
    const err = await this.call('invite_respond', { p_invite: invite.id, p_accept: accept });
    if (!err && accept) {
      await app.reloadChannels();
      app.view = invite.channel_id;
    }
    return err;
  }
  cancelInvite(invite: Invite) {
    return this.call('invite_cancel', { p_invite: invite.id });
  }
  async leave(channelId: number) {
    const err = await this.call('chat_leave', { p_channel: channelId });
    if (!err) await app.reloadChannels();
    return err;
  }
  removeMember(channelId: number, id: string) {
    return this.call('chat_remove', { p_channel: channelId, p_user: id });
  }
  async rename(channelId: number, name: string) {
    const err = await this.call('chat_rename', { p_channel: channelId, p_name: name });
    if (!err) await app.reloadChannels();
    return err;
  }
  async deleteChat(channelId: number) {
    const err = await this.call('chat_delete', { p_channel: channelId });
    if (!err) await app.reloadChannels();
    return err;
  }
}

export const social = new Social();
