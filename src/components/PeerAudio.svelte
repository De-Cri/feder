<script lang="ts">
  import { prefs } from '../lib/prefs.svelte';

  // Riproduzione con <audio>: così la cancellazione dell'eco del browser
  // "sente" anche l'audio degli altri e non lo rimanda indietro.
  let { stream, volume }: { stream: MediaStream; volume: number } = $props();
  let el: HTMLAudioElement | undefined = $state();

  $effect(() => {
    if (el && el.srcObject !== stream) el.srcObject = stream;
    el?.play().catch(() => {});
  });

  $effect(() => {
    if (el) el.volume = Math.min(1, Math.max(0, volume));
  });

  $effect(() => {
    const sink = prefs.speakerId;
    const a = el as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | undefined;
    if (a?.setSinkId) a.setSinkId(sink || '').catch(() => {});
  });
</script>

<audio bind:this={el} autoplay></audio>
