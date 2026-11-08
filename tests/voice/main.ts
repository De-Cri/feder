import { app } from '../../src/lib/state.svelte';
import { voice } from '../../src/lib/voice.svelte';
import { prefs } from '../../src/lib/prefs.svelte';

const me = new URLSearchParams(location.search).get('u')!;
app.session = { user: { id: me } } as any;
app.members = ['a', 'b', 'c'].map((id) => ({ user_id: id, role: 'member', joined_at: '' }));
(window as any).voice = voice;
(window as any).app = app;
(window as any).prefs = prefs;
(window as any).snapshot = () =>
  Object.fromEntries(
    Object.values(voice.peers).map((p: any) => [
      p.id,
      {
        conn: p.connection,
        audio: p.stream.getAudioTracks().filter((t: MediaStreamTrack) => t.readyState === 'live').length,
        hasVideo: p.hasVideo,
        st: { ...p.stats, sig: p.pc.signalingState, ice: p.pc.iceConnectionState, g: p.pc.iceGatheringState, polite: p.polite },
      },
    ]),
  );
