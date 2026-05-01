import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

type Locale = 'en' | 'es' | 'fr' | 'pt-BR';
type Params = Record<string, string | number>;

const translations: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  es: {
    'sandbox.notRunning': 'El sandbox no está en ejecución',
    'sandbox.running': 'Sandbox: en ejecución',
    'sandbox.workspace': 'Espacio de trabajo: {host} → {guest}',
    'sandbox.diary': 'Diario de MoltNet: {diary}',
    'sandbox.notConfigured': 'no configurado',
  },
  fr: {
    'sandbox.notRunning': 'Le sandbox n’est pas en cours d’exécution',
    'sandbox.running': 'Sandbox : en cours d’exécution',
    'sandbox.workspace': 'Espace de travail : {host} → {guest}',
    'sandbox.diary': 'Journal MoltNet : {diary}',
    'sandbox.notConfigured': 'non configuré',
  },
  'pt-BR': {
    'sandbox.notRunning': 'O sandbox não está em execução',
    'sandbox.running': 'Sandbox: em execução',
    'sandbox.workspace': 'Workspace: {host} → {guest}',
    'sandbox.diary': 'Diário MoltNet: {diary}',
    'sandbox.notConfigured': 'não configurado',
  },
};

let currentLocale: Locale = 'en';

export function initI18n(pi: ExtensionAPI): void {
  pi.events?.emit?.('pi-core/i18n/registerBundle', {
    namespace: 'themoltnet-pi-extension',
    defaultLocale: 'en',
    locales: translations,
  });

  pi.events?.emit?.('pi-core/i18n/requestApi', {
    onReady: (api: { getLocale?: () => string; onLocaleChange?: (cb: (locale: string) => void) => void }) => {
      const next = api.getLocale?.();
      if (isLocale(next)) currentLocale = next;
      api.onLocaleChange?.((locale) => {
        if (isLocale(locale)) currentLocale = locale;
      });
    },
  });
}

export function t(key: string, fallback: string, params: Params = {}): string {
  const template = currentLocale === 'en' ? fallback : translations[currentLocale]?.[key] ?? fallback;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

function isLocale(locale: string | undefined): locale is Locale {
  return locale === 'en' || locale === 'es' || locale === 'fr' || locale === 'pt-BR';
}
