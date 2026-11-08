<script lang="ts">
  // Audio della chiamata: sempre montato (anche mentre guardi un canale di testo),
  // altrimenti uscendo dalla schermata vocale non sentiresti più gli altri.
  import { app } from '../lib/state.svelte';
  import { voice } from '../lib/voice.svelte';
  import { prefs, userVolume } from '../lib/prefs.svelte';
  import PeerAudio from './PeerAudio.svelte';

  const peers = $derived(Object.values(voice.peers));

  function volumeOf(id: string) {
    if (voice.deaf || app.voiceMutes[id]) return 0;
    return prefs.outputVolume * userVolume(id);
  }

  // Mute imposto dall'admin: applicato appena cambia, ovunque tu sia nell'app.
  $effect(() => {
    void app.voiceMutes[app.me ?? ''];
    voice.applyMic();
  });
</script>

{#each peers as p (p.id)}
  {#each p.audioStreams as s (s.id)}
    <PeerAudio stream={s} volume={volumeOf(p.id)} />
  {/each}
{/each}
