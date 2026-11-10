<script lang="ts">
  // Volume 0–200%: cursore + percentuale modificabile. Rotellina e frecce = 1% alla volta,
  // così si arriva a qualsiasi valore (col solo trascinamento un pixel vale più di 1%).
  let { label, value, onchange }: { label: string; value: number; onchange: (v: number) => void } = $props();

  const pct = $derived(Math.round(value * 100));
  const set = (p: number) => onchange(Math.min(200, Math.max(0, Math.round(p))) / 100);

  function wheel(e: WheelEvent) {
    e.preventDefault();
    set(pct + (e.deltaY < 0 ? 1 : -1));
  }
</script>

<label class="vol">
  <span>{label}</span>
  <input type="range" min="0" max="200" step="1" value={pct}
    oninput={(e) => set(Number(e.currentTarget.value))} onwheel={wheel} />
  <input class="pct" type="number" min="0" max="200" step="1" value={pct}
    onchange={(e) => set(Number(e.currentTarget.value) || 0)} onwheel={wheel}
    onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  <span class="unit">%</span>
</label>

<style>
  .vol { display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 13px; }
  .vol input[type='range'] { flex: 1; min-width: 0; accent-color: var(--accent); }
  .pct {
    width: 42px;
    padding: 2px 4px;
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text);
    font-size: 12px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .pct::-webkit-inner-spin-button, .pct::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .unit { margin-left: -6px; color: var(--text-2); font-size: 12px; }
</style>
