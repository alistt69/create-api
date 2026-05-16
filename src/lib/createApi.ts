import { mutation } from '../model/mutation.js';
import { query } from '../model/query.js';
import {
    getQueryData,
    getQueryKeyByEndpointArg,
    invalidateTags,
    selectQueryState,
    setQueryData,
    setQueryKeySerializer,
    setQueryTagResolver,
    subscribeToQuery,
    updateQueryData,
} from '../model/queryStore.js';
import { type BaseQueryFn, type CreateApiResult, type CreateApiUtil, type GeneralDefinition } from '../model/types.js';
import { getHookName } from './getHookName.js';
import { initiateQuery } from './initiateQuery.js';
import { makeLazyQueryHook } from './makeLazyQueryHook.js';
import { makeMutationHook } from './makeMutationHook.js';
import { makeQueryHook } from './makeQueryHook.js';
import { typedObjectKeys } from './typedObjectKeys.js';
import { initiateMutation } from './initiateMutation.js';

export interface BaseQueryArgs {
    url: string;
    body?: unknown;
    method?: string;
    signal?: AbortSignal;
    params?: Record<string, unknown>;
}

interface CreateApiConfig<T extends Record<string, GeneralDefinition>> {
    baseQuery: BaseQueryFn;
    endpoints: (builder: { query: typeof query; mutation: typeof mutation }) => T;
}

export function createApi<T extends Record<string, GeneralDefinition>>({
    endpoints,
    baseQuery,
}: CreateApiConfig<T>): CreateApiResult<T> {
    const transformedEndpoints = endpoints({ query, mutation });

    const keys = typedObjectKeys(transformedEndpoints);
    const apiResult: Record<string, unknown> = {};
    const localEndpoints: Record<string, unknown> = {};

    keys.forEach((endpointName) => {
        const definition = transformedEndpoints[endpointName];

        const makeHookProps = {
            baseQuery,
            endpointName,
            ...definition,
        };

        if (definition.type === 'query') {
            localEndpoints[endpointName] = {
                name: endpointName,
                type: definition.type,
                select: (arg: unknown) => selectQueryState(endpointName, arg),
                initiate: (arg: unknown) => initiateQuery(makeHookProps, arg),
                subscribe: (arg: unknown, listener: () => void) => subscribeToQuery(
                    getQueryKeyByEndpointArg(endpointName, arg),
                    listener,
                    definition.keepUnusedDataFor ?? 0,
                ),
            };
        }

        if (definition.type === 'mutation') {
            localEndpoints[endpointName] = {
                name: endpointName,
                type: definition.type,
                initiate: (arg: unknown) => initiateMutation(makeHookProps, arg),
            };
        }

        if (definition.type === 'query') {
            setQueryKeySerializer(
                endpointName,
                (arg) => definition.serializeArgs
                    ? definition.serializeArgs(arg)
                    : JSON.stringify(arg),
            );

            setQueryTagResolver(
                endpointName,
                definition.providesTags
                    ? (data, arg) => definition.providesTags?.(data, arg) || []
                    : undefined,
            );

            apiResult[getHookName(endpointName, definition.type, 'Lazy')] = makeLazyQueryHook(makeHookProps);
        }

        apiResult[getHookName(endpointName, definition.type, '')] = definition.type === 'query'
            ? (
                makeQueryHook(makeHookProps)
            ) : (
                makeMutationHook(makeHookProps)
            );
    });

    const util: CreateApiUtil = {
        getQueryData,
        setQueryData,
        updateQueryData,
        invalidateTags,
    };

    return { ...apiResult, endpoints: localEndpoints, util } as CreateApiResult<T>;
}
