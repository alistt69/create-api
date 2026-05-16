import { type InferQueryState, type RequiredWithUndefined, type TagDescription } from './types.js';

type QueryState = InferQueryState<unknown>;

export function getInitialQueryState<R = unknown>(): RequiredWithUndefined<InferQueryState<R>> {
    return {
        data: undefined,
        error: undefined,
        status: 'uninitialized',
        isUninitialized: true,
        isLoading: false,
        isFetching: false,
        isSuccess: false,
        isError: false,
        fulfilledAt: undefined,
        requestId: undefined,
    };
}

export const querySubscriptionsCount = new Map<string, number>();

export const queryEndpointByKey = new Map<string, string>();

export const queryGcTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function incrementQuerySubscriptions(key: string): number {
    const currentCount = querySubscriptionsCount.get(key) ?? 0;
    const nextCount = currentCount + 1;

    querySubscriptionsCount.set(key, nextCount);

    return nextCount;
}

export function decrementQuerySubscriptions(key: string): number {
    const currentCount = querySubscriptionsCount.get(key) ?? 0;
    const nextCount = Math.max(0, currentCount - 1);

    querySubscriptionsCount.set(key, nextCount);

    return nextCount;
}

export const queryKeySerializers = new Map<string, (arg: unknown) => string>();

export function setQueryKeySerializer(
    endpointName: string,
    serializer: (arg: unknown) => string,
) {
    queryKeySerializers.set(endpointName, serializer);
}

export function getQueryKeyByEndpointArg(endpointName: string, arg: unknown): string {
    const serializer = queryKeySerializers.get(endpointName);
    const serializedArg = serializer ? serializer(arg) : JSON.stringify(arg);

    return `${endpointName}::${serializedArg}`;
}

export function normalizeTag(tag: TagDescription): string {
    if (typeof tag === 'string') {
        return tag;
    }

    if (tag.id === undefined) {
        return tag.type;
    }

    return `${tag.type}/${tag.id}`;
}

export function normalizeTags(tags: TagDescription[]): string[] {
    return tags.map(normalizeTag);
}

export function getQueryData<R>(endpointName: string, arg: unknown): R | undefined {
    const key = getQueryKeyByEndpointArg(endpointName, arg);

    return getQueryState(key)?.data as R | undefined;
}

export function selectQueryState<R>(endpointName: string, arg: unknown): InferQueryState<R> {
    const key = getQueryKeyByEndpointArg(endpointName, arg);

    return (getQueryState(key) as InferQueryState<R> | undefined) ?? getInitialQueryState<R>();
}

export function setQueryData<R>(endpointName: string, arg: unknown, data: R) {
    const key = getQueryKeyByEndpointArg(endpointName, arg);

    updateQueryState(key, (prevState) => ({
        ...prevState,
        data,
        error: undefined,
        status: 'fulfilled',
        isUninitialized: false,
        isLoading: false,
        isFetching: false,
        isSuccess: true,
        isError: false,
        fulfilledAt: Date.now(),
    }));

    const tags = getQueryTagsForData(endpointName, data, arg);
    setTagsForQueryKey(key, tags);
}

export const queryListeners = new Map<string, (() => void)[]>();

export function subscribeToQuery(key: string, listener: () => void, keepUnusedDataFor: number): () => void {
    if (!queryListeners.has(key)) {
        queryListeners.set(key, []);
    }

    incrementQuerySubscriptions(key);

    const gcTimeout = queryGcTimeouts.get(key);

    if (gcTimeout) {
        clearTimeout(gcTimeout);
        queryGcTimeouts.delete(key);
    }

    queryListeners.get(key)!.push(listener);

    return function unsubscribe() {
        const listeners = queryListeners.get(key);

        if (listeners) {
            queryListeners.set(
                key,
                listeners.filter((currentListener) => currentListener !== listener),
            );
        }

        const nextCount = decrementQuerySubscriptions(key);

        if (nextCount === 0) {
            scheduleCleanupIfUnused(key, keepUnusedDataFor);
        }
    };
}

export function notifyQueryListeners(key: string) {
    const listeners = queryListeners.get(key) ?? [];

    listeners.forEach((listener) => {
        listener();
    });
}

export const queryStore = new Map<string, QueryState>();

export function getQueryState(key: string): QueryState | undefined {
    return queryStore.get(key);
}

export function initQueryState(key: string): QueryState {
    if (!queryStore.has(key)) {
        const newValue: RequiredWithUndefined<QueryState> = getInitialQueryState();

        queryStore.set(key, newValue);
    }

    return queryStore.get(key)!;
}

export function updateQueryState(
    key: string,
    updater: (prevState: QueryState) => QueryState,
): QueryState {
    const newState = updater(initQueryState(key));

    queryStore.set(key, newState);
    notifyQueryListeners(key);

    return newState;
}

export const inFlightQueries = new Map<string, Promise<unknown>>();

export function getInFlightQuery<T = unknown>(key: string): Promise<T> | undefined {
    return inFlightQueries.get(key) as Promise<T> | undefined;
}

export function setInFlightQuery<T = unknown>(key: string, promise: Promise<T>) {
    inFlightQueries.set(key, promise);
}

export function clearInFlightQuery(key: string, promise?: Promise<unknown>) {
    if (promise && inFlightQueries.get(key) !== promise) {
        return;
    }

    inFlightQueries.delete(key);
}

type QueryRunner = () => Promise<unknown> | undefined;

export const queryRunners = new Map<string, QueryRunner>();

export function setQueryRunner(key: string, runner: QueryRunner) {
    queryRunners.set(key, runner);
}

export function refetchQueryByKey(key: string): Promise<unknown> | undefined {
    const runner = queryRunners.get(key);

    return runner?.();
}

export function refetchQueriesByEndpoint(endpointName: string): Promise<unknown>[] {
    const keys = queryKeysByEndpoint.get(endpointName);

    if (!keys) {
        return [];
    }

    return Array.from(keys)
        .map((key) => refetchQueryByKey(key))
        .filter((value): value is Promise<unknown> => value !== undefined);
}

export function clearQueryRunner(key: string) {
    queryRunners.delete(key);
}

export const queryKeysByEndpoint = new Map<string, Set<string>>();

export function registerQueryKey(endpointName: string, key: string) {
    if (!queryKeysByEndpoint.has(endpointName)) {
        queryKeysByEndpoint.set(endpointName, new Set());
    }

    queryEndpointByKey.set(key, endpointName);
    queryKeysByEndpoint.get(endpointName)?.add(key);
}

export function unregisterQueryKey(endpointName: string, key: string) {
    const keys = queryKeysByEndpoint.get(endpointName);

    if (!keys) {
        return;
    }

    keys.delete(key);
    queryEndpointByKey.delete(key);

    if (keys.size === 0) {
        queryKeysByEndpoint.delete(endpointName);
    }
}

export function cleanupQuery(key: string) {
    abortQueryByKey(key);
    clearTagsForQueryKey(key);

    const endpointName = queryEndpointByKey.get(key);

    if (endpointName) {
        unregisterQueryKey(endpointName, key);
    }

    queryStore.delete(key);
    inFlightQueries.delete(key);
    queryListeners.delete(key);
    queryRunners.delete(key);
    queryGcTimeouts.delete(key);
    querySubscriptionsCount.delete(key);
}

export const queryKeysByTag = new Map<string, Set<string>>();
export const queryTagsByKey = new Map<string, Set<string>>();

export function clearTagsForQueryKey(key: string) {
    const tags = queryTagsByKey.get(key);

    if (!tags) {
        return;
    }

    tags.forEach((tag) => {
        const keys = queryKeysByTag.get(tag);

        if (!keys) {
            return;
        }

        keys.delete(key);

        if (keys.size === 0) {
            queryKeysByTag.delete(tag);
        }
    });

    queryTagsByKey.delete(key);
}

export function setTagsForQueryKey(key: string, tags: TagDescription[]) {
    clearTagsForQueryKey(key);

    const uniqueTags = new Set(normalizeTags(tags));
    queryTagsByKey.set(key, uniqueTags);

    uniqueTags.forEach((tag) => {
        if (!queryKeysByTag.has(tag)) {
            queryKeysByTag.set(tag, new Set());
        }

        queryKeysByTag.get(tag)!.add(key);
    });
}

export function getQueryKeysByTag(tag: string): string[] {
    return Array.from(queryKeysByTag.get(tag) ?? []);
}

export function invalidateTags(tags: TagDescription[]): Promise<unknown>[] {
    const keys = new Set(
        normalizeTags(tags).flatMap((tag) => getQueryKeysByTag(tag)),
    );

    return Array.from(keys)
        .map((key) => refetchQueryByKey(key))
        .filter((value): value is Promise<unknown> => value !== undefined);
}

export const queryTagResolvers = new Map<string, (data: unknown, arg: unknown) => TagDescription[]>();

export function setQueryTagResolver(
    endpointName: string,
    resolver?: (data: unknown, arg: unknown) => TagDescription[],
) {
    if (!resolver) {
        queryTagResolvers.delete(endpointName);
        return;
    }

    queryTagResolvers.set(endpointName, resolver);
}

export function getQueryTagsForData(endpointName: string, data: unknown, arg: unknown): TagDescription[] {
    const resolver = queryTagResolvers.get(endpointName);

    if (!resolver) {
        return [];
    }

    return resolver(data, arg);
}

export function updateQueryData<R>(
    endpointName: string,
    arg: unknown,
    updater: (prevData: R | undefined) => R,
): R {
    const key = getQueryKeyByEndpointArg(endpointName, arg);
    const prevData = getQueryState(key)?.data as R | undefined;
    const nextData = updater(prevData);

    updateQueryState(key, (prevState) => ({
        ...prevState,
        data: nextData,
        error: undefined,
        status: 'fulfilled',
        isUninitialized: false,
        isLoading: false,
        isFetching: false,
        isSuccess: true,
        isError: false,
        fulfilledAt: Date.now(),
    }));

    const tags = getQueryTagsForData(endpointName, nextData, arg);
    setTagsForQueryKey(key, tags);

    return nextData;
}

export const queryAbortControllers = new Map<string, AbortController>();

export function setQueryAbortController(key: string, controller: AbortController) {
    queryAbortControllers.set(key, controller);
}

export function clearQueryAbortController(key: string, controller?: AbortController) {
    if (controller && queryAbortControllers.get(key) !== controller) {
        return;
    }

    queryAbortControllers.delete(key);
}

export function abortQueryByKey(key: string) {
    const controller = queryAbortControllers.get(key);

    if (!controller) {
        return;
    }

    controller.abort();
    queryAbortControllers.delete(key);
}

export function scheduleCleanupIfUnused(key: string, keepUnusedDataFor: number) {
    const subscriptionsCount = querySubscriptionsCount.get(key) ?? 0;

    if (subscriptionsCount > 0) {
        return;
    }

    const existingTimeout = queryGcTimeouts.get(key);

    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
        cleanupQuery(key);
    }, keepUnusedDataFor);

    queryGcTimeouts.set(key, timeout);
}
