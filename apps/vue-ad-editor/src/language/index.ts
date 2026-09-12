import { createI18n } from 'vue-i18n';
import en from './en.json';

const i18n = createI18n({
  allowComposition: true,
  globalInjection: true,
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
});

export default i18n;
export const t = (key: string) => i18n.global.t(key);
