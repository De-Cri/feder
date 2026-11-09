<script lang="ts">
  // Ritaglio foto profilo: quadrato centrato, con zoom e spostamento.
  // Restituisce un JPEG quadrato di 256 px.
  let { file, onconfirm, oncancel }: {
    file: File;
    onconfirm: (blob: Blob) => void;
    oncancel: () => void;
  } = $props();

  const VIEW = 260; // lato dell'anteprima (px)
  const OUT = 256; // lato del file salvato (px)

  let img = $state<HTMLImageElement | null>(null);
  let url = $state('');
  let zoom = $state(1);
  let dx = $state(0);
  let dy = $state(0);
  let busy = $state(false);
  let drag: { x: number; y: number; dx: number; dy: number } | null = null;

  $effect(() => {
    const u = URL.createObjectURL(file);
    url = u;
    const i = new Image();
    i.onload = () => {
      img = i;
      zoom = 1;
      dx = 0;
      dy = 0;
    };
    i.onerror = () => oncancel();
    i.src = u;
    return () => URL.revokeObjectURL(u);
  });

  // Dimensione dell'immagine a zoom 1: il lato minore riempie il riquadro.
  const base = $derived(img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1);
  const scale = $derived(base * zoom);
  const W = $derived(img ? img.naturalWidth * scale : VIEW);
  const H = $derived(img ? img.naturalHeight * scale : VIEW);
  const maxX = $derived(Math.max(0, (W - VIEW) / 2));
  const maxY = $derived(Math.max(0, (H - VIEW) / 2));

  function clamp() {
    dx = Math.min(maxX, Math.max(-maxX, dx));
    dy = Math.min(maxY, Math.max(-maxY, dy));
  }

  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, dx, dy };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    dx = drag.dx + (e.clientX - drag.x);
    dy = drag.dy + (e.clientY - drag.y);
    clamp();
  }
  function up() {
    drag = null;
  }

  function onZoom(v: number) {
    zoom = v;
    clamp();
  }

  function confirm() {
    if (!img || busy) return;
    busy = true;
    const c = document.createElement('canvas');
    c.width = c.height = OUT;
    const ctx = c.getContext('2d');
    if (!ctx) {
      busy = false;
      return oncancel();
    }
    ctx.imageSmoothingQuality = 'high';
    // Porzione visibile del riquadro, riportata alle coordinate originali dell'immagine.
    const side = VIEW / scale;
    const sx = (maxX - dx) / scale;
    const sy = (maxY - dy) / scale;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);
    c.toBlob(
      (b) => {
        busy = false;
        if (b) onconfirm(b);
        else oncancel();
      },
      'image/jpeg',
      0.9,
    );
  }
</script>

<div class="cropper">
  <h3>Ritaglia la foto</h3>
  <div
    class="frame"
    style="width:{VIEW}px;height:{VIEW}px"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="presentation"
  >
    {#if img}
      <img
        src={url}
        alt=""
        draggable="false"
        style="width:{W}px;height:{H}px;left:{maxX - dx}px;top:{maxY - dy}px"
      />
    {/if}
    <div class="mask"></div>
  </div>
  <label class="zoom">
    <span>Zoom</span>
    <input
      type="range"
      min="1"
      max="3"
      step="0.01"
      value={zoom}
      oninput={(e) => onZoom(Number(e.currentTarget.value))}
    />
  </label>
  <div class="actions">
    <button type="button" class="btn" onclick={oncancel}>Annulla</button>
    <button type="button" class="btn primary" disabled={!img || busy} onclick={confirm}>
      Usa questa foto
    </button>
  </div>
</div>

<style>
  .cropper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 20px;
    width: fit-content;
    border-radius: var(--r-lg);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .frame {
    position: relative;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: #000;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .frame:active { cursor: grabbing; }
  .frame img { position: absolute; max-width: none; pointer-events: none; }
  .mask {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
    pointer-events: none;
  }
  .zoom { display: flex; align-items: center; gap: 10px; width: 100%; font-size: 13px; color: var(--text-2); }
  .zoom input { flex: 1; accent-color: var(--accent); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
</style>