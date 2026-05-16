import { useCallback, useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'use-sync-external-store/shim';
import {
    setQueryRunner,
    initQueryState,
    clearQueryRunner,
    subscribeToQuery,
    registerQueryKey,
} from '../model/queryStore.js';
import { type QueryHookOptions } from '../model/types.js';
import { runQuery, type RunQueryProps } from './runQuery.js';

export function makeQueryHook<R, A, Raw = R>(
    props: RunQueryProps<R, A, Raw>,
) {
    const {
        endpointName,
        serializeArgs,
        staleTime = 0,
        keepUnusedDataFor = 0,
    } = props;

    return function useGeneratedQuery(arg: A, options?: QueryHookOptions) {
        const enabled = options?.enabled ?? true;
        const refetchOnMount = options?.refetchOnMount ?? true;

        const serializedArg = serializeArgs ? serializeArgs(arg) : JSON.stringify(arg);
        const key = `${endpointName}::${serializedArg}`;

        const argRef = useRef(arg);
        argRef.current = arg;

        const state = useSyncExternalStore(
            (onStoreChange) => subscribeToQuery(key, onStoreChange, keepUnusedDataFor),
            () => initQueryState(key),
            () => initQueryState(key),
        );

        const run = useCallback((requestArg: A) => {
            return runQuery(props, requestArg, { key });
        }, [key]);

        const refetch = useCallback(() => {
            return run(argRef.current);
        }, [run]);

        useEffect(() => {
            registerQueryKey(endpointName, key);

            if (enabled) {
                setQueryRunner(key, () => run(arg));
            }
            else {
                clearQueryRunner(key);
            }
        }, [key, run, enabled]);

        useEffect(() => {
            if (!enabled) {
                return;
            }

            const currentState = initQueryState(key);

            if (currentState.data === undefined || currentState.fulfilledAt === undefined) {
                void run(arg).catch(() => undefined);
                return;
            }

            if (!refetchOnMount) {
                return;
            }

            const isFresh = Date.now() - currentState.fulfilledAt < staleTime;

            if (!isFresh) {
                void run(arg).catch(() => undefined);
            }
        }, [enabled, key, run, refetchOnMount]);

        return { ...state, refetch };
    };
}
