import { LANGUAGES, type Language } from './i18n';

/**
 * The first start (nothing saved yet) opens in the language of the computer (#3723): the first of the browser's preferred languages that
 * Strata has. "pt-BR" is Portuguese, "zh-TW", "zh-HK", "zh-MO" and "zh-Hant" are Traditional Chinese, any other "zh" is Simplified. Null when none of them is offered.
 */
export function detectLanguage(tags: readonly string[] | null | undefined): Language | null {
  for (const raw of tags ?? []) {
    const tag = String(raw).toLowerCase().replace(/_/g, '-');
    const base = /^zh-(tw|hk|mo|hant)(-|$)/.test(tag) ? 'zh-TW' : tag.split('-')[0];
    const found = LANGUAGES.find(l => l.value === base);
    if (found) return found.value;
  }
  return null;
}
