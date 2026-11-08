import { prefs } from './prefs.svelte';
import { showNotification } from './platform';

export function notify(title: string, body: string) {
  if (!prefs.notifications) return;
  showNotification(title, body.slice(0, 140));
}
