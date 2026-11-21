# Plan: opening Feder to 100 users

Goal: anyone can join (cap 100), `#generale` and `#random` are public, the rest stays for the founders, and anyone can create private text/voice chats for the friends they invite.

## Decisions

| | |
|---|---|
| Private chats | Protected by RLS like `#generale` (no end-to-end encryption) |
| Friend requests | Anyone can send them, rate-limited, with blocking |
| DMs and pokes | Friends only |
| Sign-up abuse | 10 public joins an hour + admin switch. Turnstile dropped: the desktop apps don't run on a web domain, and Supabase would require it for logins too |
| Founders | Everyone in the server today. All friends with each other automatically |

## Model

- `members.tier`: `founder` or `public`.
- `channels.visibility`: `public` (generale, random), `founders` (Lounge, Gaming), `private` (user chats, members in `channel_members`).
- `can_see_channel(id)` is the single rule, used by channels, messages, attachments, voice rooms and realtime topics.
- `friendships`, `blocks`, `channel_invites`. Every write goes through a `security definer` function with limits.
- Limits: 10 chats owned per user, voice chats 8 people (P2P mesh), text chats 25, 20 friend requests and 40 invites per hour.

## Phases

1. **Private chats and friends** (password still on, nothing changes for outsiders)
   - [x] `0008_private_chats.sql` + `05_private_chats_test.sql`
   - [x] Client: right sidebar with chats, new chat dialog, friends & invites page, chat menu (invite, members, leave, rename, delete), founder notice, DMs/pokes friends-only in the UI
   - [ ] Release 0.6.0, founders try it
2. **Hardening before going public**
   - [x] Lobby presence: don't publish which voice channel you're in, read it from `voice_rooms` (RLS-filtered)
   - [ ] Profiles/online status: decide what a public user sees (today: everyone's username, avatar, online)
   - [x] 10 MB attachments for public users (founders 50 MB)
   - [ ] Per-user storage quota (free tier: 1 GB storage)
   - [ ] Supabase Pro (~$25/month) or stay on Free, see the cost notes below
3. **Open sign-ups**
   - [x] `join_open()` without password, `server_config.open` switch (Settings → Server), `max_members = 100`, 10 joins an hour, new members get `tier = 'public'`
   - [x] Join screen: one button when open, founders' password when closed
   - [ ] Apply 0008 + 0009, release 0.6.0, flip the switch, announce
4. **Later, if public users ask**
   - [ ] Translate #general / #random into English. Best option found: a "Translate" button through DeepL's free plan in a Supabase function, cached so each message is translated once. On-device (Firefox's engine) is private but adds ~30–40 MB; the browser's built-in translator isn't available in WebView2/Electron.

## Costs (rough, check current prices)

Supabase Pro ~$25/month once public (Free has 1 GB storage and pauses idle projects). TURN on Cloudflare's free tier, voice/video P2P, GitHub and hosting free. €1/month per user loses ~45% to VAT and fees; €10/year or donations work better.
