// Interface language: Italian or English. Follows the system language unless the user
// picks one in Settings → Appearance. Strings live in src/locales/{it,en}.ts.
import { prefs } from './prefs.svelte';
import { it } from '../locales/it';
import { en } from '../locales/en';

export type Lang = 'it' | 'en';
export type Key = keyof typeof it;

const DICTS: Record<Lang, Record<Key, string>> = { it, en };

function systemLang(): Lang {
  try {
    return (navigator.language || '').toLowerCase().startsWith('it') ? 'it' : 'en';
  } catch {
    return 'en';
  }
}

/** Current language (reactive: it reads prefs.language). */
export function lang(): Lang {
  return prefs.language === 'it' || prefs.language === 'en' ? prefs.language : systemLang();
}

/** Locale for dates and numbers. */
export function locale(): string {
  return lang() === 'it' ? 'it-IT' : 'en-GB';
}

/** Translated text for `key`; {placeholders} are filled from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const s: string = DICTS[lang()][key] ?? it[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
