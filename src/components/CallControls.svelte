<script lang="ts">
  // Call buttons, bottom left in the sidebar.
  // Microphone and headphones are always there (so you can join already muted), the rest only in a call.
  import { voice, screenShareSupported } from '../lib/voice.svelte';
  import Icon from './Icon.svelte';
  import MicMenu from './MicMenu.svelte';

  const size = 17;

  // Right-click on the microphone: input/output volumes and level.
  let micMenu = $state<DOMRect | null>(null);
  function openMicMenu(e: MouseEvent) {
    e.preventDefault();
    micMenu = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }
</script>

<button
  class="icon-btn"
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
  class:bad={voice.deaf}
  title={voice.deaf ? 'Riattiva audio' : 'Disattiva audio'}
  onclick={() => voice.toggleDeaf()}
>
  <Icon name={voice.deaf ? 'headphones-off' : 'headphones'} {size} />
</button>
{#if voice.channelId !== null}
  <button
    class="icon-btn"
    class:on={voice.camOn}
    title={voice.camOn ? 'Spegni webcam' : 'Accendi webcam'}
    onclick={() => voice.toggleCam()}
  >
    <Icon name={voice.camOn ? 'video' : 'video-off'} {size} />
  </button>
  {#if screenShareSupported}
    <button
      class="icon-btn"
      class:on={voice.screenOn}
      title={voice.screenOn ? 'Interrompi condivisione' : 'Condividi schermo'}
      onclick={() => voice.toggleScreen()}
    >
      <Icon name="screen" {size} />
    </button>
  {/if}
  <button class="icon-btn bad" title="Termina chiamata" onclick={() => voice.leave()}>
    <Icon name="leave" {size} />
  </button>
{/if}

{#if micMenu}
  <MicMenu anchor={micMenu} onclose={() => (micMenu = null)} />
{/if}

<style>
  .open { background: var(--bg-active); color: var(--text); }
  .open.bad { color: var(--red); }
</style>
