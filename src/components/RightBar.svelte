<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { social, FRIENDS_VIEW } from '../lib/social.svelte';
  import Icon from './Icon.svelte';
  import MemberList from './MemberList.svelte';
  import { t } from '../lib/i18n.svelte';

  // Right column: people. Friends & invites, then the server's members.
  // (Your private chats are on the left, with the channels.)
</script>

<aside class="right">
  <div class="top">
    <button class="nav-item" class:active={app.view === FRIENDS_VIEW} onclick={() => (app.view = FRIENDS_VIEW)}>
      <Icon name="users" size={16} />
      <span class="name">{t('social.page')}</span>
      {#if social.pending}<span class="badge">{social.pending}</span>{/if}
    </button>
  </div>

  <MemberList />
</aside>

<style>
  .right {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
  }
  .top {
    flex: none;
    padding: 10px 10px 8px;
    border-bottom: 1px solid var(--border);
  }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    display: grid;
    place-items: center;
  }
</style>
