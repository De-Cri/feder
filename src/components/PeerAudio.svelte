<script module lang="ts">
  type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
  // Un solo AudioContext per tutte le persone amplificate oltre il 100%, non uno
  // a testa (ognuno è un thread audio con la sua uscita). Si chiude quando
  // nessuno lo usa più.
  let shared: SinkContext | null = null;
  let users = 0;
  function acquire(): SinkContext {
    users++;
    if (!shared || shared.state === 'closed') shared = new AudioContext();
    return shared;
  }
  function release() {
    if (--users > 0 || !shared) return;
    users = 0;
    shared.close().catch(() => {});
    shared = null;
  }
</script>

<script lang="ts">
  import { prefs } from '../lib/prefs.svelte';

  // Riproduzione con <audio>: così la cancellazione dell'eco del browser
  // "sente" anche l'audio degli altri e non lo rimanda indietro.
  // Sopra il 100% <audio>.volume non basta (max 1): si passa da un GainNode
  // e l'<audio> resta muto (in Chromium serve comunque per far scorrere lo stream remoto).
  // ponytail: oltre il 100% l'AEC potrebbe non vedere l'audio amplificato; se torna eco, limitare a 1.
  let { stream, volume }: { stream: MediaStream; volume: number } = $props();
  let el: HTMLAudioElement | undefined = $state();
  /** Amplificazione oltre il 100%: esiste solo mentre serve. */
  let amp: { ctx: SinkContext; src: MediaStreamAudioSourceNode; gain: GainNode; stream: MediaStream } | null = null;

  function stopAmp() {
    if (!amp) return;
    amp.src.disconnect();
    amp.gain.disconnect();
    amp = null;
    release();
  }

  $effect(() => {
    if (el && el.srcObject !== stream) el.srcObject = stream;
    el?.play().catch(() => {});
  });
  // Rimosso il componente (persona uscita, stream finita): stacca subito lo stream.
  $effect(() => {
    const a = el;
    if (!a) return;
    return () => {
      a.srcObject = null;
    };
  });

  $effect(() => {
    if (!el) return;
    const v = Math.min(2, Math.max(0, volume));
    if (v <= 1) {
      el.muted = false;
      el.volume = v;
      stopAmp(); // non serve più: niente grafo audio acceso a guadagno 0
      return;
    }
    if (amp && amp.stream !== stream) stopAmp();
    if (!amp) {
      const ctx = acquire();
      const gain = ctx.createGain();
      const src = ctx.createMediaStreamSource(stream);
      src.connect(gain).connect(ctx.destination);
      ctx.setSinkId?.(prefs.speakerId || '').catch(() => {});
      amp = { ctx, src, gain, stream };
    }
    amp.ctx.resume().catch(() => {});
    amp.gain.gain.value = v;
    el.muted = true;
  });

  $effect(() => {
    const sink = prefs.speakerId;
    const a = el as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | undefined;
    if (a?.setSinkId) a.setSinkId(sink || '').catch(() => {});
    amp?.ctx.setSinkId?.(sink || '').catch(() => {});
  });

  $effect(() => () => stopAmp());
</script>

<audio bind:this={el} autoplay></audio>
