interface ImportMetaEnv {
  readonly MODE: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly VITE_KRATOS_URL?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ViteHotContext {
  readonly data: unknown;
  accept(cb?: (mod: unknown) => void): void;
  dispose(cb: (data: unknown) => void): void;
  decline(): void;
  invalidate(message?: string): void;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: ViteHotContext;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
