<script lang="ts">
  // Ritaglio foto profilo.
  // L'immagine è centrata nel riquadro, spostata di (ox, oy) rispetto al centro.
  // Lo zoom ingrandisce attorno al centro. Il riquadro VIEW è esattamente ciò che viene salvato.
  let { file, onconfirm, oncancel }: {
    file: File;
    onconfirm: (blob: Blob) => void;
    oncancel: () => void;
  } = $props();

  const VIEW = 260; // lato del riquadro (px)
  const OUT = 256; // lato del file salvato (px)

  let img = $state.raw<HTMLImageElement | null>(null);
  let url = $state('');
  let zoom = $state(1);
  let ox = $state(0); // spostamento orizzontale rispetto al centro (px)
  let oy = $state(0); // spostamento verticale rispetto al centro (px)
  let busy = $state(false);
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;

  $effect(() => {
    const u = URL.createObjectURL(file);
    url = u;
    const i = new Image();
    i.onload = () => {
      img = i;
      zoom = 1;
      ox = 0;
      oy = 0;
    };
    i.onerror = () => oncancel();
    i.src = u;
    return () => URL.revokeObjectURL(u);
  });

  // A zoom 1 il lato minore dell'immagine coincide con il riquadro, quindi nessun vuoto.
  const base = $derived(img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1);
  const scale = $derived(base * zoom);
  const W = $derived(img ? img.naturalWidth * scale : VIEW);
  const H = $derived(img ? img.naturalHeight * scale : VIEW);
  // Quanto si può spostare l'immagine dal centro senza lasciare bordi vuoti.
  const maxX = $derived(Math.max(0, (W - VIEW) / 2));
  const maxY = $derived(Math.max(0, (H - VIEW) / 2));
  // Posizione dell'angolo in alto a sinistra dell'immagine, nel riquadro.
  const left = $derived(VIEW / 2 + ox - W / 2);
  const top = $derived(VIEW / 2 + oy - H / 2);

  function clamp() {
    ox = Math.min(maxX, Math.max(-maxX, ox));
    oy = Math.min(maxY, Math.max(-maxY, oy));
  }

  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, ox, oy };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    // Il mouse a destra sposta l'immagine a destra: stesso verso del trascinamento.
    ox = drag.ox + (e.clientX - drag.x);
    oy = drag.oy + (e.clientY - drag.y);
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
    // Porzione dell'immagine originale che sta dentro il riquadro.
    const sx = -left / scale;
    const sy = -top / scale;
    const side = VIEW / scale;
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
        style="width:{W}px;height:{H}px;left:{left}px;top:{top}px"
      />
    {/if}
    <div class="mask"></div>
  </div>
  <p class="hint">Trascina per spostare, usa lo zoom per ingrandire.</p>
  <label class="zoom">
    <span>Zoom</span>
    <input
      type="range"
      min="1"
      max={MAX_ZOOM}
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

<script module lang="ts">
  const MAX_ZOOM = 3;
</script>

<style>
  .cropper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    width: fit-content;
    border-radius: var(--r-lg);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .hint { margin: 0; font-size: 12px; color: var(--text-3); }
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