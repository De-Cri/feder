<script lang="ts">
  // Audio della chiamata: sempre montato (anche mentre guardi un canale di testo),
  // altrimenti uscendo dalla schermata vocale non sentiresti più gli altri.
  import { app } from '../lib/state.svelte';
  import { voice } from '../lib/voice.svelte';
  import { prefs, userVolume, screenVolume } from '../lib/prefs.svelte';
  import PeerAudio from './PeerAudio.svelte';

  const peers = $derived(Object.values(voice.peers));

  // Voce e audio dello schermo hanno volumi separati: puoi zittire la stream
  // di un amico e continuare a sentire lui.
  function volumeOf(id: string, screen: boolean) {
    if (voice.deaf) return 0;
    if (screen) return prefs.outputVolume * screenVolume(id);
    if (app.voiceMutes[id]) return 0;
    return prefs.outputVolume * userVolume(id);
  }

  // Mute imposto dall'admin: applicato appena cambia, ovunque tu sia nell'app.
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
