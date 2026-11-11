<script lang="ts">
  // Volume: cursore + percentuale modificabile. Rotellina e frecce = 1% alla volta,
  // così si arriva a qualsiasi valore (col solo trascinamento un pixel vale più di 1%).
  // max in percento (200 = fino al doppio). Oltre il 100% la traccia ha una tacca di riferimento.
  let { label, value, max = 200, onchange }: {
    label: string;
    value: number;
    max?: number;
    onchange: (v: number) => void;
  } = $props();

  const pct = $derived(Math.round(value * 100));
  const fill = $derived((Math.min(pct, max) / max) * 100);
  const set = (p: number) => onchange(Math.min(max, Math.max(0, Math.round(p))) / 100);

  function wheel(e: WheelEvent) {
    e.preventDefault();
    set(pct + (e.deltaY < 0 ? 1 : -1));
  }
</script>

<div class="vol">
  <span class="label">{label}</span>
  <input
    class="range"
    type="range"
    min="0"
    {max}
    step="1"
    value={pct}
    aria-label={label}
    style="--fill:{fill}%; --mark:{max > 100 ? (100 / max) * 100 : -10}%"
    oninput={(e) => set(Number(e.currentTarget.value))}
    onwheel={wheel}
    ondblclick={() => set(100)}
    title="Doppio clic: 100%"
  />
  <label class="pct">
    <input
      type="number"
      min="0"
      {max}
      step="1"
      value={pct}
      aria-label="{label} in percento"
      onchange={(e) => set(Number(e.currentTarget.value) || 0)}
      onwheel={wheel}
      onfocus={(e) => e.currentTarget.select()}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />%
  </label>
</div>

<style>
  .vol { display: flex; align-items: center; gap: 10px; padding: 6px 8px; font-size: 13px; }
  .label { min-width: 60px; color: var(--text-2); }

  /* Traccia sottile riempita fino al valore, pallino che cresce al passaggio. */
  .range {
    flex: 1;
    min-width: 0;
    height: 16px;
    margin: 0;
    background: transparent;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }
  .range:focus { outline: none; }
  .range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background:
      linear-gradient(var(--text-3), var(--text-3)) var(--mark) 0 / 2px 100% no-repeat,
      linear-gradient(var(--accent), var(--accent)) 0 0 / var(--fill) 100% no-repeat,
      var(--border-strong);
  }
  .range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--border-strong); }
  .range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--accent); }
  .range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s, box-shadow 0.12s;
  }
  .range::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }
  .range:hover::-webkit-slider-thumb { transform: scale(1.15); }
  .range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px var(--accent-soft), 0 1px 3px rgba(0, 0, 0, 0.35); }

  /* Percentuale: testo semplice, diventa un campo solo al passaggio o in modifica. */
  .pct {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    width: 50px;
    padding: 2px 6px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    cursor: text;
    transition: background 0.12s, box-shadow 0.12s;
  }
  .pct:hover { background: var(--bg-hover); }
  .pct:focus-within { background: var(--bg-input); box-shadow: 0 0 0 2px var(--accent-soft); color: var(--text); }
  .pct input {
    width: 3ch;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: right;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .pct input::-webkit-inner-spin-button, .pct input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
</style>
