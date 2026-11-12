<script lang="ts">
  import { onMount } from 'svelte';

  type Option = { value: string; label: string; sub?: string };

  let {
    value,
    options,
    onchange,
    placeholder = '',
  }: {
    value: string;
    options: Option[];
    onchange: (v: string) => void;
    placeholder?: string;
  } = $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  const current = $derived(options.find((o) => o.value === value) ?? null);

  function pick(v: string) {
    open = false;
    if (v !== value) onchange(v);
  }

  // A click outside the menu closes it (capture phase, like the other menus).
  function outside(e: Event) {
    if (root && e.target instanceof Node && root.contains(e.target)) return;
    open = false;
  }

  onMount(() => {
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="dd" bind:this={root}>
  <button type="button" class="trigger" class:open aria-expanded={open} onclick={() => (open = !open)}>
    <span class="text">
      <span class="main">{current?.label ?? placeholder}</span>
      {#if current?.sub}<span class="sub">{current.sub}</span>{/if}
    </span>
    <svg class="chev" class:up={open} width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>

  {#if open}
    <ul class="list" role="listbox">
      {#each options as o (o.value)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected={o.value === value}
            class="opt"
            class:sel={o.value === value}
            onclick={() => pick(o.value)}
          >
            <span class="text">
              <span class="main">{o.label}</span>
              {#if o.sub}<span class="sub">{o.sub}</span>{/if}
            </span>
            {#if o.value === value}
              <svg class="check" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dd { position: relative; width: 100%; }
  .trigger {
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-radius: var(--r-sm);
    background: var(--bg-input);
    text-align: left;
    color: var(--text);
    transition: background 0.12s;
  }
  .trigger:hover { background: var(--bg-active); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .main {
    font-size: 15px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev { color: var(--text-2); flex: none; transition: transform 0.15s; }
  .chev.up { transform: rotate(180deg); }

  .list {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 50;
    max-height: 320px;
    overflow-y: auto;
    margin: 0;
    padding: 8px;
    list-style: none;
    border-radius: var(--r);
    background: var(--bg-sidebar);
    box-shadow: var(--shadow);
  }
  .list li { margin: 0 0 2px; }
  .opt {
    width: 100%;
    padding: 8px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-radius: var(--r-sm);
    text-align: left;
    color: var(--text);
  }
  .opt:hover { background: var(--bg-hover); }
  .opt.sel { background: var(--bg-active); }
  .check { color: var(--accent); flex: none; }
</style>