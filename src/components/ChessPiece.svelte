<script lang="ts">
  import type { Color, Kind } from '../lib/chess';

  // Flat pieces, black and white only: one silhouette per kind, drawn for Feder.
  let { c, k }: { c: Color; k: Kind } = $props();

  const BASE = 'M24 80h52a4 4 0 0 1 4 4v6H20v-6a4 4 0 0 1 4-4z';
  const body: Record<Kind, string> = {
    p: 'M50 18a12 12 0 0 1 8 21l5 5h-6c1 12 6 23 13 32H30c7-9 12-20 13-32h-6l5-5a12 12 0 0 1 8-21z',
    r: 'M26 16h11v8h7v-8h12v8h7v-8h11v20l-8 6v28l8 8H26l8-8V42l-8-6z',
    n: 'M30 78c0-18 8-26 16-34-8 3-16 6-21 1-4-5 0-12 6-17 7-6 11-14 17-17l3 6c14 2 26 14 26 34 0 12-4 20-4 27z',
    b: 'M50 10a6 6 0 0 1 4 10c11 9 17 20 14 32-2 8-8 12-12 14l6 12H38l6-12c-4-2-10-6-12-14-3-12 3-23 14-32a6 6 0 0 1 4-10z',
    q: 'M24 78 16 30l14 22 3-30 9 26 8-32 8 32 9-26 3 30 14-22-8 48z',
    k: 'M46 6h8v8h8v8h-8v9c4 2 7 5 9 8 6-5 18-4 21 6 3 11-4 23-10 33H26c-6-10-13-22-10-33 3-10 15-11 21-6 2-3 5-6 9-8v-9h-8v-8h8z',
  };
  // small marks that make the shape readable (bishop's cut, knight's eye, queen's crown points)
  const detail: Partial<Record<Kind, string>> = {
    b: 'M57 30 46 44',
    n: 'M50 32h.01',
    k: 'M36 62h28',
    q: 'M32 66h36',
  };
  const fill = $derived(c === 'w' ? '#f7f7f7' : '#262626');
  const line = $derived(c === 'w' ? '#262626' : '#e8e8e8');
</script>

<svg viewBox="0 0 100 100" aria-hidden="true">
  <g fill={fill} stroke="#1c1c1c" stroke-width="3.5" stroke-linejoin="round">
    <path d={body[k]} />
    <path d={BASE} />
    {#if k === 'q'}
      {#each [[16, 28], [33, 20], [50, 14], [67, 20], [84, 28]] as [x, y]}<circle cx={x} cy={y} r="5" />{/each}
    {/if}
  </g>
  {#if detail[k]}
    <path d={detail[k]} fill="none" stroke={line} stroke-width={k === 'n' ? 7 : 3.5} stroke-linecap="round" />
  {/if}
</svg>

<style>
  svg { width: 100%; height: 100%; display: block; pointer-events: none; }
</style>
