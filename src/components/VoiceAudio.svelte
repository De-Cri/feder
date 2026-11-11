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
    if (screen) return voice.watching[id] ? prefs.outputVolume * screenVolume(id) : 0;
    if (app.voiceMutes[id]) return 0;
    return prefs.outputVolume * userVolume(id);
  }

  // Schermi condivisi: chi condivide sa se lo guardi, così se non lo guardi non te lo manda.
  // Condivisione finita → la prossima volta che riparte va riaperta con un click.
  const sharing = (id: string) => !!app.presence[id]?.screen || !!voice.peers[id]?.hasScreen;
  $effect(() => {
    for (const id of Object.keys(voice.watching)) if (!sharing(id)) delete voice.watching[id];
    for (const p of peers) if (sharing(p.id)) voice.send(p.id, { watch: !!voice.watching[p.id] });
  });

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
