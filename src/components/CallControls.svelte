<script lang="ts">
  // Pulsanti della chiamata: nella barra laterale o sotto la chiamata (Impostazioni → Aspetto).
  import { voice, screenShareSupported } from '../lib/voice.svelte';
  import Icon from './Icon.svelte';
  import MicMenu from './MicMenu.svelte';

  let { big = false }: { big?: boolean } = $props();
  const size = $derived(big ? 20 : 17);

  // Tasto destro sul microfono: volumi di ingresso/uscita e livello.
  let micMenu = $state<DOMRect | null>(null);
  function openMicMenu(e: MouseEvent) {
    e.preventDefault();
    micMenu = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }
</script>

<button
  class="icon-btn"
  class:big
  class:bad={!voice.micOn || voice.adminMuted}
  class:open={micMenu !== null}
  title={voice.adminMuted ? 'Silenziato dall’admin' : voice.micOn ? 'Disattiva microfono' : 'Attiva microfono'}
  onclick={() => voice.toggleMic()}
  oncontextmenu={openMicMenu}
>
  <Icon name={voice.micOn && !voice.adminMuted ? 'mic' : 'mic-off'} {size} />
</button>
<button
  class="icon-btn"
  class:big
  class:bad={voice.deaf}
  title={voice.deaf ? 'Riattiva audio' : 'Disattiva audio'}
  onclick={() => voice.toggleDeaf()}
>
  <Icon name={voice.deaf ? 'headphones-off' : 'headphones'} {size} />
</button>
<button
  class="icon-btn"
  class:big
  class:on={voice.camOn}
  title={voice.camOn ? 'Spegni webcam' : 'Accendi webcam'}
  onclick={() => voice.toggleCam()}
>
  <Icon name={voice.camOn ? 'video' : 'video-off'} {size} />
</button>
{#if screenShareSupported}
  <button
    class="icon-btn"
    class:big
    class:on={voice.screenOn}
    title={voice.screenOn ? 'Interrompi condivisione' : 'Condividi schermo'}
    onclick={() => voice.toggleScreen()}
  >
    <Icon name="screen" {size} />
  </button>
{/if}
<button class="icon-btn bad" class:big class:leave={big} title="Termina chiamata" onclick={() => voice.leave()}>
  <Icon name="leave" {size} />
</button>

{#if micMenu}
  <MicMenu anchor={micMenu} onclose={() => (micMenu = null)} />
{/if}

<style>
  .open { background: var(--bg-active); color: var(--text); }
  .open.bad { color: var(--red); }
  .big { width: 44px; height: 44px; border-radius: var(--r); background: var(--bg-elev); }
  .big:hover { background: var(--bg-hover); }
  .big.leave { width: 64px; background: var(--red); color: #fff; }
  .big.leave:hover { filter: brightness(1.15); }
</style>
