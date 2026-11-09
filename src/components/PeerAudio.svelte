<script lang="ts">
  import { prefs } from '../lib/prefs.svelte';

  // Riproduzione con <audio>: così la cancellazione dell'eco del browser
  // "sente" anche l'audio degli altri e non lo rimanda indietro.
  // Sopra il 100% <audio>.volume non basta (max 1): si passa da un GainNode
  // e l'<audio> resta muto (in Chromium serve comunque per far scorrere lo stream remoto).
  // ponytail: oltre il 100% l'AEC potrebbe non vedere l'audio amplificato; se torna eco, limitare a 1.
  let { stream, volume }: { stream: MediaStream; volume: number } = $props();
  let el: HTMLAudioElement | undefined = $state();
  let ctx: (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | undefined;
  let gain: GainNode | undefined;

  $effect(() => {
    if (el && el.srcObject !== stream) el.srcObject = stream;
    el?.play().catch(() => {});
  });

  $effect(() => {
    if (!el) return;
    const v = Math.min(2, Math.max(0, volume));
    if (v <= 1) {
      el.muted = false;
      el.volume = v;
      if (gain) gain.gain.value = 0;
      return;
    }
    if (!ctx) {
      ctx = new AudioContext();
      gain = ctx.createGain();
      ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
      ctx.setSinkId?.(prefs.speakerId || '').catch(() => {});
    }
    ctx.resume().catch(() => {});
    gain!.gain.value = v;
    el.muted = true;
  });

  $effect(() => {
    const sink = prefs.speakerId;
    const a = el as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | undefined;
    if (a?.setSinkId) a.setSinkId(sink || '').catch(() => {});
    ctx?.setSinkId?.(sink || '').catch(() => {});
  });

  $effect(() => () => {
    ctx?.close().catch(() => {});
  });
</script>

<audio bind:this={el} autoplay></audio>
