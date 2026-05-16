import { type BaseQueryArgs } from '../lib/createApi.js';

export type RequiredWithUndefined<T> = {
    [K in keyof Required<T>]: T[K] extends undefined ? T[K] : T[K];
};

export type EndpointType = 'query' | 'mutation';

export type TagDescription = string | {
    type: string;
    id?: string | number;
};

export type HookName<K extends string, T extends EndpointType, L extends string = ''> = `use${L}${Capitalize<K>}${Capitalize<T>}`;

export type LazyQueryHook<R, A> = () => readonly [
    (arg: A) => Promise<R>,
    InferQueryState<R> & LazyQueryManagers<R>,
];

export interface CreateApiUtil {
    getQueryData: <R>(endpointName: string, arg: unknown) => R | undefined;
    setQueryData: <R>(endpointName: string, arg: unknown, data: R) => void;
    updateQueryData: <R>(endpointName: string, arg: unknown, updater: (prevData: R | undefined) => R) => R;
    invalidateTags: (tags: TagDescription[]) => Promise<unknown>[];
}

export interface MutationInitiateResult<R, A> {
    requestId: string;
    arg: A;
    promise: Promise<R>;
    unwrap: () => Promise<R>;
    abort: () => void;
}

export interface QueryInitiateResult<R, A> {
    requestId: string;
    arg: A;
    promise: Promise<R>;
    unwrap: () => Promise<R>;
    abort: () => void;
    unsubscribe: () => void;
    refetch: () => Promise<R>;
}

export interface QueryController<R, A> {
    readonly state: InferQueryState<R>;
    run: (arg: A) => Promise<R>;
    refetch: () => Promise<R> | undefined;
    abort: () => void;
    dispose: () => void;
}

export type QueryStateListener = () => void;

export interface MutationController<R, A> {
    readonly state: InferMutationState<R>;
    run: (arg: A) => Promise<R>;
    abort: () => void;
    reset: () => void;
    dispose: () => void;
}

export interface ApiEndpointMutation<R, A> {
    name: string;
    type: 'mutation';
    initiate: (arg: A) => MutationInitiateResult<R, A>;
}

export interface ApiEndpointQuery<R, A> {
    name: string;
    type: 'query';
    select: (arg: A) => InferQueryState<R>;
    initiate: (arg: A) => QueryInitiateResult<R, A>;
    subscribe: (arg: A, listener: QueryStateListener) => () => void;
}

export type BaseQueryResult<D = unknown, E = unknown, M = unknown> = (
    | {
        data: D;
        error?: undefined;
        meta?: M;
    }
    | {
        error: E;
        data?: undefined;
        meta?: M;
    }
);

export type BaseQueryFn<D = unknown, E = unknown, M = unknown, A = BaseQueryArgs> = (
    args: A,
) => Promise<BaseQueryResult<D, E, M>>;

export type CreateApiResult<T extends Record<string, GeneralDefinition<unknown, unknown>>> = {
    [K in keyof T as HookName<K & string, T[K]['type']>]: InferHook<T[K]>;
} & {
    [K in keyof T as T[K]['type'] extends 'query'
        ? HookName<K & string, 'query', 'Lazy'>
        : never
    ]: T[K] extends QueryBuilderDefinition<infer R, infer A, infer _Raw>
        ? LazyQueryHook<R, A>
        : never;
} & {
    endpoints: {
        [K in keyof T]: T[K] extends QueryBuilderDefinition<infer R, infer A, infer _Raw>
            ? ApiEndpointQuery<R, A>
            : T[K] extends MutationBuilderDefinition<infer R, infer A, infer _Raw>
                ? ApiEndpointMutation<R, A>
                : never;
    };
    util: CreateApiUtil;
};

export type InferHook<Def> = Def extends QueryBuilderDefinition<infer R, infer A, infer _Raw>
    ? QueryHook<R, A>
    : Def extends MutationBuilderDefinition<infer R, infer A, infer _Raw>
        ? MutationHook<R, A>
        : never;

export type QueryTagsResolver<R, A> = (result: R, arg: A) => TagDescription[];

export interface QueryBuilderDefinitionBase<R, A> {
    /**
     * Internal endpoint kind discriminator.
     */
    type: 'query';

    /**
     * Builds request config for `baseQuery` from query arguments.
     *
     * Receives hook arguments and returns a transport-level request description.
     */
    query: (args: A) => BaseQueryArgs;

    /**
     * Custom query key serializer.
     *
     * Used to build cache key for shared store, dedupe, stale checks and refetching.
     * If omitted, a default serialization strategy is used.
     */
    serializeArgs?: (args: A) => string;

    /**
     * Time in milliseconds during which cached data is considered fresh.
     *
     * While data is fresh, automatic refetch on mount is skipped.
     * Manual `refetch()` should still work.
     *
     * @default 0
     */
    staleTime?: number;

    /**
     * Time in milliseconds to keep unused cached data after the last subscriber unmounts.
     *
     * When the last subscriber disappears, cache entry is scheduled for garbage collection.
     * If a new subscriber appears before timeout expires, cleanup is cancelled.
     *
     * @default 0
     */
    keepUnusedDataFor?: number;

    /**
     * Declares which tags this query provides after a successful request.
     *
     * These tags are later used by mutations through `invalidatesTags`
     * to determine which cached queries should be refetched.
     */
    providesTags?: QueryTagsResolver<R, A>;

    /**
     * Transforms query error before it is written into hook state.
     *
     * Useful for normalizing transport errors into a shape convenient for UI.
     */
    transformErrorResponse?: (error: unknown, arg: A) => unknown;
}

interface QueryBuilderDefinitionTransform<R, A, Raw> {
    /**
     * Transforms raw `baseQuery` response into final hook result.
     *
     * Use this when transport response shape differs from the desired `data` shape.
     * The returned value becomes cached query data and is exposed by the hook.
     */
    transformResponse: (response: Raw, arg: A) => R;
}

/**
 * Query endpoint definition.
 *
 * @template R Final result type that will be exposed in hook `data`
 * after `transformResponse` is applied.
 * @template A Query argument type passed into the generated hook and `query`.
 * @template Raw Raw response type returned by `baseQuery` before transformation.
 */
export type QueryBuilderDefinition<R, A, Raw = R> = (
    QueryBuilderDefinitionBase<R, A>
    & { type: 'query' }
    & Partial<QueryBuilderDefinitionTransform<R, A, Raw>>
);

export type QueryDefinitionInput<R, A, Raw = R> = QueryBuilderDefinitionBase<R, A> & (
    [Raw] extends [R]
        ? Partial<QueryBuilderDefinitionTransform<R, A, Raw>>
        : QueryBuilderDefinitionTransform<R, A, Raw>
    );

export type MutationTagsResolver<R, A> = (result: R, arg: A) => TagDescription[];

export interface MutationBuilderDefinitionBase<R, A> {
    /**
     * Internal endpoint kind discriminator.
     */
    type: 'mutation';

    /**
     * Builds request config for `baseQuery` from mutation arguments.
     *
     * Receives trigger arguments and returns a transport-level request description.
     */
    query: (args: A) => BaseQueryArgs;

    /**
     * Endpoint names that should be refetched after a successful mutation.
     *
     * This is a coarse invalidation mechanism: all active queries of listed endpoints
     * will be refetched.
     */
    invalidates?: string[];

    /**
     * Tags that should be invalidated after a successful mutation.
     *
     * This is a more precise invalidation mechanism than `invalidates`.
     * Matching cached queries that provided these tags will be refetched.
     */
    invalidatesTags?: MutationTagsResolver<R, A>;

    /**
     * Transforms mutation error before it is written into mutation state
     * and rethrown from trigger.
     */
    transformErrorResponse?: (error: unknown, arg: A) => unknown;
}

interface MutationBuilderDefinitionTransform<R, A, Raw> {
    /**
     * Transforms raw `baseQuery` response into final mutation result.
     *
     * The returned value becomes the resolved trigger result and mutation `data`.
     */
    transformResponse: (response: Raw, arg: A) => R;
}

/**
 * Mutation endpoint definition.
 *
 * @template R Final result type returned by mutation trigger and exposed in mutation state
 * after `transformResponse` is applied.
 * @template A Mutation argument type passed into trigger and `query`.
 * @template Raw Raw response type returned by `baseQuery` before transformation.
 */
export type MutationBuilderDefinition<R, A, Raw = R> = (
    MutationBuilderDefinitionBase<R, A>
    & { type: 'mutation' }
    & Partial<MutationBuilderDefinitionTransform<R, A, Raw>>
);

export type MutationDefinitionInput<R, A, Raw = R> = MutationBuilderDefinitionBase<R, A> & (
    [Raw] extends [R]
        ? Partial<MutationBuilderDefinitionTransform<R, A, Raw>>
        : MutationBuilderDefinitionTransform<R, A, Raw>
    );

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeneralDefinition<R = any, A = any, Raw = R> = (
    MutationBuilderDefinition<R, A, Raw> | QueryBuilderDefinition<R, A, Raw>
);

export interface InferMutationState<R> {
    data?: R;
    isLoading: boolean;
    error?: unknown;
}

export type QueryStatus = 'uninitialized' | 'pending' | 'fulfilled' | 'rejected';

export interface InferQueryState<R> {
    data?: R;
    error?: unknown;
    status: QueryStatus;
    isUninitialized: boolean;
    isLoading: boolean;
    isFetching: boolean;
    isSuccess: boolean;
    isError: boolean;
    fulfilledAt?: number;
    requestId?: string;
}

export interface QueryManagers<R> {
    refetch: () => Promise<R>;
}

export interface LazyQueryManagers<R> {
    refetch: () => Promise<R> | undefined;
}

export interface MutationManagers {
    reset: () => void;
}

export interface QueryHookOptions {
    /**
     * Enables or disables automatic query execution.
     *
     * When `false`, the hook does not automatically start a request on mount
     * and does not react to stale data policy.
     * Manual `refetch()` is still allowed.
     *
     * @default true
     */
    enabled?: boolean;

    /**
     * Controls whether the hook should automatically refetch cached data on mount.
     *
     * - `true` — refetch on mount only if cached data is stale
     * - `false` — do not refetch on mount if cached data already exists
     *
     * If there is no cached data yet, the initial request is still executed
     * regardless of this option.
     *
     * @default true
     */
    refetchOnMount?: boolean;
}

export type QueryHook<R, A> = (arg: A, options?: QueryHookOptions) => (
    InferQueryState<R> & QueryManagers<R>
);

export type MutationHook<R, A> = () => readonly [
    (arg: A) => Promise<R>,
    InferMutationState<R> & MutationManagers,
];

export interface FetchBaseQueryMeta {
    request: Request;
    response: Response;
}

export type FetchBaseQueryError
    = | {
        status: number;
        data: unknown;
    }
    | {
        status: 'FETCH_ERROR';
        error: string;
    }
    | {
        status: 'PARSING_ERROR';
        originalStatus: number;
        data: string;
        error: string;
    }
    | {
        status: 'TIMEOUT_ERROR';
        error: string;
    }
    | {
        status: 'CUSTOM_ERROR';
        error: string;
        data?: unknown;
    };

export interface FetchBaseQueryArgs extends BaseQueryArgs {
    headers?: HeadersInit;
    responseHandler?: 'json' | 'text' | 'content-type' | ((response: Response) => Promise<unknown>);
    validateStatus?: (response: Response, body: unknown) => boolean;
    timeout?: number;
}

export interface FetchBaseQueryOptions {
    baseUrl?: string;
    prepareHeaders?: (
        headers: Headers,
        context: { arg: FetchBaseQueryArgs },
    ) => Headers | void;
    paramsSerializer?: (params: Record<string, unknown>) => string;
    fetchFn?: typeof fetch;
    timeout?: number;
    responseHandler?: 'json' | 'text' | 'content-type' | ((response: Response) => Promise<unknown>);
    validateStatus?: (response: Response, body: unknown) => boolean;
}
