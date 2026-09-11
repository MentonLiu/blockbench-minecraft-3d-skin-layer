import { en, type TranslationKey } from './strings';
import { zh } from './strings';

let registered = false;

/**
 * Registers the plugin's strings with Blockbench's translation system so the
 * built-in `tl()` lookup resolves them for every supported interface language.
 * Safe to call repeatedly (plugin reload).
 */
export function registerTranslations(): void {
  if (registered) {
    return;
  }
  Language.addTranslations('en', en);
  Language.addTranslations('zh', zh);
  registered = true;
}

/** Looks up a string in the current language; English text is the fallback. */
export function t(key: TranslationKey, variables?: Array<string | number>): string {
  const fallback = en[key];
  return tl(key, variables && variables.length ? variables : undefined, fallback);
}
