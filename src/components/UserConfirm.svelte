<script lang="ts">
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import { errorText } from '../lib/util';
  import { t } from '../lib/i18n.svelte';

  let { id, action, onclose }: {
    id: string;
    action: 'kick' | 'ban';
    onclose: () => void;
  } = $props();

  let reason = $state('');
  let error = $state<string | null>(null);

  async function confirm() {
    error = null;
    const { error: err } =
      action === 'kick'
        ? await supabase.rpc('admin_kick', { p_user: id })
        : await supabase.rpc('admin_ban', { p_user: id, p_reason: reason.trim() || null });
    if (err) error = errorText(err);
    else onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="bg" role="presentation" onclick={onclose}>
  <div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <h3>{t(action === 'kick' ? 'confirm.kickTitle' : 'confirm.banTitle', { name: app.name(id) })}</h3>
    <p class="muted">{action === 'kick' ? t('confirm.kickHint') : t('confirm.banHint')}</p>
    {#if action === 'ban'}
      <input class="field" placeholder={t('confirm.reason')} bind:value={reason} />
    {/if}
    {#if error}<p class="err">{error}</p>{/if}
    <div class="row">
      <button class="btn" onclick={onclose}>{t('common.cancel')}</button>
      <button class="btn danger" onclick={confirm}>{action === 'kick' ? t('menu.kick') : t('menu.ban')}</button>
    </div>
  </div>
</div>

<style>
  .bg {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
  }
  .modal {
    width: 380px;
    padding: 22px;
    border-radius: var(--r-lg);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h3 { margin: 0; font-size: 16px; }
  p { margin: 0; font-size: 13px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  .err { color: var(--red); font-size: 13px; }
</style>