<script lang="ts">
  // Logo di Feder: la piuma (96 px, ~5 KB).
  import feder from '../assets/feder.png?no-inline'; // file a parte: serve solo nella schermata di accesso
  let { size = 18 }: { size?: number } = $props();
</script>

<img src={feder} width={size} height={size} alt="" aria-hidden="true" draggable="false" />

<style>
  /* La piuma è bianca: l'ombra la rende visibile anche col tema chiaro. */
  img { display: block; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
</style>
