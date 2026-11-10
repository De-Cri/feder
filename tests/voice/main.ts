import { mount } from 'svelte';
import VoiceAudio from '../../src/components/VoiceAudio.svelte';
import { app } from '../../src/lib/state.svelte';
import { voice, preferHardwareCodec } from '../../src/lib/voice.svelte';
import { prefs } from '../../src/lib/prefs.svelte';
import { soundLog } from '../../src/lib/sounds';

const me = new URLSearchParams(location.search).get('u')!;
app.session = { user: { id: me } } as any;
app.members = ['a', 'b', 'c'].map((id) => ({ user_id: id, role: 'member', joined_at: '' }));
(window as any).voice = voice;
(window as any).preferHardwareCodec = preferHardwareCodec;
(window as any).app = app;
(window as any).prefs = prefs;
(window as any).soundLog = soundLog;
app.channels = [3, 4].map((id) => ({ id, name: 'v' + id, kind: 'voice', position: id })) as any;
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

// L'audio della chiamata vive fuori dalla schermata vocale (come in Shell).
mount(VoiceAudio, { target: document.body });

// ?ui=1: mostra anche la schermata vocale vera (riquadri video), per i test di memoria.
if (new URLSearchParams(location.search).has('ui')) {
  const { default: VoiceChannel } = await import('../../src/components/VoiceChannel.svelte');
  const target = document.createElement('div');
  target.style.cssText = 'width:1000px;height:700px;display:flex;flex-direction:column';
  document.body.appendChild(target);
  mount(VoiceChannel, { target, props: { channel: app.channels[0] } });
}
