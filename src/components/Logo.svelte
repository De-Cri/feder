<script lang="ts">
  // Feder's logo: the feather (96 px, ~5 KB).
  import feder from '../assets/feder.png?no-inline'; // separate file: only needed on the login screen
  let { size = 18 }: { size?: number } = $props();
</script>

<img src={feder} width={size} height={size} alt="" aria-hidden="true" draggable="false" />

<style>
  /* The feather is white: the shadow makes it visible on the light theme too. */
  img { display: block; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
</style>
