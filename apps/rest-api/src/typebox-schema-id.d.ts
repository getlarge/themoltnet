import 'typebox';

import type { TRef, TSchemaOptions } from 'typebox';

declare module 'typebox' {
  interface TSchema {
    readonly $id?: string;
  }

  function Ref(ref: string | undefined, options?: TSchemaOptions): TRef<string>;
}
