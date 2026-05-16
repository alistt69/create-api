import { invalidateTags, refetchQueriesByEndpoint } from '../model/queryStore.js';
import {
    type BaseQueryFn,
    type MutationBuilderDefinition,
    type MutationInitiateResult,
} from '../model/types.js';
import { createRequestId } from './createRequestId.js';

type InitiateMutationProps<R, A, Raw = R> = {
    baseQuery: BaseQueryFn<Raw>;
} & Omit<MutationBuilderDefinition<R, A, Raw>, 'type'>;

export function initiateMutation<R, A, Raw = R>(
    {
        query,
        baseQuery,
        invalidates,
        invalidatesTags,
        transformResponse,
        transformErrorResponse,
    }: InitiateMutationProps<R, A, Raw>,
    arg: A,
): MutationInitiateResult<R, A> {
    const requestId = createRequestId();
    const controller = new AbortController();

    const promise = (async () => {
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

            invalidates?.forEach((endpointName) => {
                refetchQueriesByEndpoint(endpointName);
            });

            if (invalidatesTags) {
                invalidateTags(invalidatesTags(data, arg));
            }

            return data;
        }
        catch (error) {
            if (controller.signal.aborted) {
                throw error;
            }

            throw error;
        }
    })();

    promise.catch(() => undefined);

    return {
        requestId,
        arg,
        promise,
        unwrap: () => promise,
        abort: () => {
            controller.abort();
        },
    };
}
