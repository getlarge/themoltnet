export type ResponseStyle = 'data' | 'fields';
export type ClientMeta = Record<string, never>;

export interface ApiRequest {
  body?: unknown;
  headers: Record<string, string>;
  method: string;
  signal?: AbortSignal;
  url: string;
}

export type RequestExecutor = <TData>(request: ApiRequest) => Promise<TData>;

export interface ClientOptions {
  baseUrl?: string;
  responseStyle?: ResponseStyle;
  signal?: AbortSignal;
  throwOnError?: boolean;
}

export interface Config<
  T extends ClientOptions = ClientOptions,
> extends ClientOptions {
  baseUrl?: T['baseUrl'];
  bodySerializer?: ((body: unknown) => unknown) | null;
  headers?: Record<string, unknown>;
  responseStyle?: T['responseStyle'];
  signal?: T['signal'];
  throwOnError?: T['throwOnError'];
  requestExecutor?: RequestExecutor;
}

export interface RequestOptions<
  TResponseStyle extends ResponseStyle = 'fields',
  ThrowOnError extends boolean = boolean,
  Url extends string = string,
> extends Config<{
  responseStyle: TResponseStyle;
  throwOnError: ThrowOnError;
}> {
  body?: unknown;
  method?: string;
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  security?: ReadonlyArray<unknown>;
  url: Url;
}

type ResponseData<T> = T extends Record<string, unknown> ? T[keyof T] : T;

export type RequestResult<
  TData = unknown,
  TError = unknown,
  ThrowOnError extends boolean = boolean,
  TResponseStyle extends ResponseStyle = 'fields',
> = ThrowOnError extends true
  ? Promise<
      TResponseStyle extends 'data'
        ? ResponseData<TData>
        : { data: ResponseData<TData> }
    >
  : Promise<
      TResponseStyle extends 'data'
        ? ResponseData<TData> | undefined
        :
            | { data: ResponseData<TData>; error: undefined }
            | { data: undefined; error: ResponseData<TError> }
    >;

type MethodFn = <
  TData = unknown,
  TError = unknown,
  ThrowOnError extends boolean = false,
  TResponseStyle extends ResponseStyle = 'fields',
>(
  options: Omit<RequestOptions<TResponseStyle, ThrowOnError>, 'method'>,
) => RequestResult<TData, TError, ThrowOnError, TResponseStyle>;

type RequestFn = <
  TData = unknown,
  TError = unknown,
  ThrowOnError extends boolean = false,
  TResponseStyle extends ResponseStyle = 'fields',
>(
  options: Omit<RequestOptions<TResponseStyle, ThrowOnError>, 'method'> & {
    method: string;
  },
) => RequestResult<TData, TError, ThrowOnError, TResponseStyle>;

/** Declared so the generated SDK typechecks; `sse.get` always rejects. */
export interface ServerSentEventsResult<TData = unknown> {
  stream: AsyncGenerator<
    TData extends Record<string, unknown> ? TData[keyof TData] : TData
  >;
}

type SseFn = <
  TData = unknown,
  _TError = unknown,
  ThrowOnError extends boolean = false,
  TResponseStyle extends ResponseStyle = 'fields',
>(
  options: Omit<RequestOptions<TResponseStyle, ThrowOnError>, 'method'>,
) => Promise<ServerSentEventsResult<TData>>;

export interface Client {
  buildUrl: (
    options: Pick<RequestOptions, 'baseUrl' | 'path' | 'query' | 'url'>,
  ) => string;
  connect: MethodFn;
  delete: MethodFn;
  get: MethodFn;
  getConfig: () => Config;
  head: MethodFn;
  options: MethodFn;
  patch: MethodFn;
  post: MethodFn;
  put: MethodFn;
  request: RequestFn;
  setConfig: (config: Config) => Config;
  /** The generated SDK only emits GET event streams. */
  sse: { get: SseFn };
  trace: MethodFn;
}

export type CreateClientConfig<T extends ClientOptions = ClientOptions> = (
  override?: Config<ClientOptions & T>,
) => Config<Required<ClientOptions> & T>;

export interface TDataShape {
  body?: unknown;
  headers?: unknown;
  path?: unknown;
  query?: unknown;
  url: string;
}

type OmitKeys<T, K> = Pick<T, Exclude<keyof T, K>>;

/** `TResponse` is a placeholder for the SDK's third type argument. */
export type Options<
  TData extends TDataShape = TDataShape,
  ThrowOnError extends boolean = boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TResponse = unknown,
  TResponseStyle extends ResponseStyle = 'fields',
> = OmitKeys<
  RequestOptions<TResponseStyle, ThrowOnError>,
  'body' | 'path' | 'query' | 'url'
> &
  ([TData] extends [never] ? unknown : Omit<TData, 'url'>);

export type QuerySerializerOptions = Record<string, never>;
export type Auth = Record<string, never>;
