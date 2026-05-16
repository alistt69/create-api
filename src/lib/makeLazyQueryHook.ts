import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSyncExternalStore } from 'use-sync-external-store/shim';
import {
    setQueryRunner,
    initQueryState,
    registerQueryKey,
    subscribeToQuery,
    scheduleCleanupIfUnused,
    getInitialQueryState,
} from '../model/queryStore.js';
import { runQuery, type RunQueryProps } from './runQuery.js';

export function makeLazyQueryHook<R, A, Raw = R>(
    props: RunQueryProps<R, A, Raw>,
) {
    const {
        endpointName,
        serializeArgs,
        keepUnusedDataFor = 0,
    } = props;

    return function useGeneratedLazyQuery() {
        const [currentArg, setCurrentArg] = useState<A | undefined>(undefined);

        const currentKey = useMemo(() => {
            if (currentArg === undefined) {
                return null;
            }

            const serializedArg = serializeArgs
                ? serializeArgs(currentArg)
                : JSON.stringify(currentArg);

            return `${endpointName}::${serializedArg}`;
        }, [currentArg]);

        const argRef = useRef<A | undefined>(currentArg);
        argRef.current = currentArg;
        const ownedKeyRef = useRef<string | null>(null);

        const emptyState = useMemo(() => getInitialQueryState<R>(), []);

        const state = useSyncExternalStore(
            (onStoreChange) => {
                if (!currentKey) {
                    return () => undefined;
                }

                return subscribeToQuery(currentKey, onStoreChange, keepUnusedDataFor);
            },
            () => {
                if (!currentKey) {
                    return emptyState;
                }

                return initQueryState(currentKey);
            },
            () => {
                if (!currentKey) {
                    return emptyState;
                }

                return initQueryState(currentKey);
            },
        );

        const run = useCallback((arg: A) => {
            const serializedArg = serializeArgs
                ? serializeArgs(arg)
                : JSON.stringify(arg);

            const key = `${endpointName}::${serializedArg}`;

            return runQuery(props, arg, { key });
        }, []);

        const trigger = useCallback((arg: A) => {
            const serializedArg = serializeArgs
                ? serializeArgs(arg)
                : JSON.stringify(arg);

            const nextKey = `${endpointName}::${serializedArg}`;
            const prevOwnedKey = ownedKeyRef.current;

            if (prevOwnedKey && prevOwnedKey !== nextKey) {
                scheduleCleanupIfUnused(prevOwnedKey, keepUnusedDataFor);
            }

            registerQueryKey(endpointName, nextKey);

            setQueryRunner(nextKey, () => run(arg));

            ownedKeyRef.current = nextKey;
            setCurrentArg(arg);

            return run(arg);
        }, [run]);

        const refetch = useCallback(() => {
            if (argRef.current === undefined) {
                return undefined;
            }

            return run(argRef.current);
        }, [run]);

        useEffect(() => {
            if (!currentKey) {
                return;
            }

            return () => {
                scheduleCleanupIfUnused(currentKey, keepUnusedDataFor);

                if (ownedKeyRef.current === currentKey) {
                    ownedKeyRef.current = null;
                }
            };
        }, [currentKey]);

        return [trigger, { ...state, refetch }] as const;
    };
}
