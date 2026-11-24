# Feder

**Private, free, extremely light.** A Discord for small groups of friends.

2.5 MB download on Windows, under 7 MB installed. Voice, webcam and screen go peer-to-peer. Private messages are end-to-end encrypted. Costs €0 to run.

**Try it in your browser: [feder-chat.web.app](https://feder-chat.web.app)** (nothing to install).

## Features

- One server, up to 100 people: text channels and a public voice channel
- Friends, and private text/voice chats only the friends you invite can see
- Images, videos and files in chat
- Encrypted private messages, gone after 30 days unless you star them
- Voice, webcam and screen sharing, with system audio on Windows
- AI noise suppression (RNNoise), noise gate, per-friend volume
- Automatic updates, light/dark theme, Italian and English

## Download

Web: [feder-chat.web.app](https://feder-chat.web.app), best in Chrome or Edge.

Desktop: [latest release](https://github.com/De-Cri/feder-releases/releases/latest): `.exe` for Windows, `.deb` / `.rpm` / `.AppImage` for Linux.

The Windows installer isn't signed yet: SmartScreen complains (*More info → Run anyway*), and with Smart App Control on Windows blocks it. Use the web app meanwhile.

## Build it yourself

Windows: double-click `Setup.cmd`. Linux: `./setup.sh`.

The wizard installs what's missing and builds the installers. Everything else (releases, TURN, security, tests) is in [docs/SETUP.md](docs/SETUP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Early commits and issues are in Italian, sorry about that.

## License

[GPL-3.0-or-later](LICENSE). Written by Samuele De Cristofaro, with contributions from Giovanni Intrieri and Daniele Filice.
