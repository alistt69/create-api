import { useCallback, useMemo, useRef, useState } from 'react';
import { invalidateTags, refetchQueriesByEndpoint } from '../model/queryStore.js';
import { type BaseQueryFn, type InferMutationState, type MutationBuilderDefinition } from '../model/types.js';

type MakeMutationHookProps<R, A, Raw = R> = {
    baseQuery: BaseQueryFn<Raw>;
} & Omit<MutationBuilderDefinition<R, A, Raw>, 'type'>;

export function makeMutationHook<R, A, Raw = R>({
    query,
    baseQuery,
    invalidates,
    invalidatesTags,
    transformResponse,
    transformErrorResponse,
}: MakeMutationHookProps<R, A, Raw>) {
    return function useGeneratedMutation() {
        const initialState: InferMutationState<R> = useMemo(() => ({
            data: undefined,
            error: undefined,
            isLoading: false,
        }), []);

        const [state, setState] = useState<InferMutationState<R>>(initialState);
        const requestIdRef = useRef(0);

        const reset = useCallback(() => {
            setState(initialState);
        }, [initialState]);

        const trigger = useCallback(async (arg: A) => {
            const requestId = requestIdRef.current + 1;
            requestIdRef.current = requestId;

            setState((prevState) => ({
                ...prevState,
                data: undefined,
                error: undefined,
                isLoading: true,
            }));

            try {
                const request = query(arg);
                const result = await baseQuery(request);

                if ('error' in result) {
                    const transformedError = transformErrorResponse
                        ? transformErrorResponse(result.error, arg)
                        : result.error;

                    throw transformedError;
                }

                const raw = result.data;
                const data = transformResponse ? transformResponse(raw, arg) : raw as unknown as R;

                if (requestIdRef.current === requestId) {
                    setState({
                        data,
                        error: undefined,
                        isLoading: false,
                    });
                }

                invalidates?.forEach((endpointName) => {
                    refetchQueriesByEndpoint(endpointName);
                });

                if (invalidatesTags) {
                    invalidateTags(invalidatesTags(data, arg));
                }

                return data;
            }
            catch (error) {
                if (requestIdRef.current === requestId) {
                    setState({
                        data: undefined,
                        isLoading: false,
                        error,
                    });
                }

                throw error;
            }
            finally {
                if (requestIdRef.current === requestId) {
                    setState((prevState) => ({
                        ...prevState,
                        isLoading: false,
                    }));
                }
            }
        }, [
            query,
            baseQuery,
            invalidates,
            invalidatesTags,
            transformResponse,
            transformErrorResponse,
        ]);

        return [trigger, { ...state, reset }] as const;
    };
}
