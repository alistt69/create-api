import {
    clearInFlightQuery,
    clearQueryAbortController,
    getInFlightQuery,
    setInFlightQuery,
    setQueryAbortController,
    setTagsForQueryKey,
    updateQueryState,
} from '../model/queryStore.js';
import { type BaseQueryFn, type QueryBuilderDefinition } from '../model/types.js';

export type RunQueryProps<R, A, Raw = R> = {
    endpointName: string;
    baseQuery: BaseQueryFn<Raw>;
} & Omit<QueryBuilderDefinition<R, A, Raw>, 'type'>;

export interface RunQueryOptions {
    key: string;
    requestId?: string;
}

export function runQuery<R, A, Raw = R>(
    props: RunQueryProps<R, A, Raw>,
    arg: A,
    options: RunQueryOptions,
): Promise<R> {
    const {
        query,
        baseQuery,
        providesTags,
        transformResponse,
        transformErrorResponse,
    } = props;

    const { key, requestId } = options;

    const existingPromise = getInFlightQuery<R>(key);

    if (existingPromise) {
        return existingPromise;
    }

    const controller = new AbortController();
    setQueryAbortController(key, controller);

    let promise!: Promise<R>;

    // eslint-disable-next-line prefer-const
    promise = (async () => {
        updateQueryState(key, (prevState) => ({
            ...prevState,
            error: undefined,
            requestId,
            status: 'pending',
            isUninitialized: false,
            isSuccess: false,
            isError: false,
            ...(prevState.data !== undefined
                ? { isFetching: true, isLoading: false }
                : { isLoading: true, isFetching: false }),
        }));

        try {
            const request = query(arg);
            const result = await baseQuery({
                ...request,
                signal: controller.signal,
            });

            if ('error' in result) {
                const transformedError = transformErrorResponse
                    ? transformErrorResponse(result.error, arg)
                    : result.error;

                throw transformedError;
            }

            const raw = result.data;
            const data = transformResponse ? transformResponse(raw, arg) : raw as unknown as R;

            if (!controller.signal.aborted) {
                updateQueryState(key, (prevState) => ({
                    ...prevState,
                    data,
                    error: undefined,
                    requestId,
                    status: 'fulfilled',
                    isUninitialized: false,
                    isSuccess: true,
                    isError: false,
                    fulfilledAt: Date.now(),
                }));

                if (providesTags) {
                    setTagsForQueryKey(key, providesTags(data, arg));
                }
            }

            return data;
        }
        catch (error) {
            updateQueryState(key, (prevState) => ({
                ...prevState,
                error,
                requestId,
                status: 'rejected',
                isUninitialized: false,
                isSuccess: false,
                isError: true,
            }));

            throw error;
        }
        finally {
            updateQueryState(key, (prevState) => ({
                ...prevState,
                isLoading: false,
                isFetching: false,
            }));

            clearInFlightQuery(key, promise);
            clearQueryAbortController(key, controller);
        }
    })();

    setInFlightQuery(key, promise);

    return promise;
}
