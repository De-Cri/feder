<script lang="ts">
  // Logo di Paper: un foglio con l'angolo piegato.
  let { size = 18 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6.5 2.5h7.2l4.8 4.8v13.2a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="var(--accent)" />
  <path d="M13.7 2.5v3.8a1 1 0 0 0 1 1h3.8z" fill="#fff" opacity=".55" />
  <rect x="8" y="11.5" width="7" height="1.6" rx=".8" fill="#fff" />
  <rect x="8" y="14.8" width="8" height="1.6" rx=".8" fill="#fff" opacity=".7" />
</svg>
