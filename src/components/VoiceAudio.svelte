<script lang="ts">
  // Call audio: always mounted (even while you look at a text channel),
  // otherwise leaving the voice screen you'd stop hearing the others.
  import { app } from '../lib/state.svelte';
  import { voice } from '../lib/voice.svelte';
  import { prefs, userVolume, screenVolume } from '../lib/prefs.svelte';
  import PeerAudio from './PeerAudio.svelte';

  const peers = $derived(Object.values(voice.peers));

  // Voice and screen audio have separate volumes: you can mute a friend's
  // stream and keep hearing them.
  function volumeOf(id: string, screen: boolean) {
    if (voice.deaf) return 0;
    if (screen) return voice.watching[id] ? prefs.outputVolume * screenVolume(id) : 0;
    if (app.voiceMutes[id]) return 0;
    return prefs.outputVolume * userVolume(id);
  }

  // Shared screens: the sharer knows whether you watch, so if you don't they don't send it.
  // Share ended → the next time it starts it must be reopened with a click.
  const sharing = (id: string) => !!app.presence[id]?.screen || !!voice.peers[id]?.hasScreen;
  $effect(() => {
    for (const id of Object.keys(voice.watching)) if (!sharing(id)) delete voice.watching[id];
    for (const p of peers) if (sharing(p.id)) voice.send(p.id, { watch: !!voice.watching[p.id] });
  });

  // Admin-imposed mute: applied as soon as it changes, wherever you are in the app.
  $effect(() => {
    void app.voiceMutes[app.me ?? ''];
    voice.applyMic();
  });
</script>

{#each peers as p (p.id)}
  {#each p.audioStreams as a (a.key)}
    <PeerAudio stream={a.stream} volume={volumeOf(p.id, p.isScreenAudio(a.key))} />
  {/each}
{/each}
