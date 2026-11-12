<script module lang="ts">
  type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
  // A single AudioContext for everyone boosted past 100%, not one each
  // (each one is an audio thread with its own output). It closes when
  // nobody uses it anymore.
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

  // Playback through <audio>: this way the browser's echo cancellation
  // "hears" the others' audio too and doesn't send it back.
  // Above 100% <audio>.volume isn't enough (max 1): we go through a GainNode
  // and the <audio> stays muted (in Chromium it's still needed to keep the remote stream flowing).
  // ponytail: above 100% AEC might not see the boosted audio; if echo comes back, cap at 1.
  let { stream, volume }: { stream: MediaStream; volume: number } = $props();
  let el: HTMLAudioElement | undefined = $state();
  /** Boost above 100%: exists only while needed. */
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
  // Component removed (person left, stream ended): detach the stream right away.
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
      stopAmp(); // no longer needed: no audio graph running at gain 0
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
