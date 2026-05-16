import {
    abortQueryByKey,
    getQueryKeyByEndpointArg,
    registerQueryKey,
    setQueryRunner,
    subscribeToQuery,
} from '../model/queryStore.js';
import { type QueryInitiateResult } from '../model/types.js';
import { createRequestId } from './createRequestId.js';
import { runQuery, type RunQueryProps } from './runQuery.js';

export function initiateQuery<R, A, Raw = R>(
    props: RunQueryProps<R, A, Raw>,
    arg: A,
): QueryInitiateResult<R, A> {
    const {
        endpointName,
        keepUnusedDataFor = 0,
    } = props;

    const key = getQueryKeyByEndpointArg(endpointName, arg);
    const requestId = createRequestId();

    registerQueryKey(endpointName, key);

    setQueryRunner(key, () => runQuery(props, arg, {
        key,
        requestId: createRequestId(),
    }));

    const unsubscribeFromQuery = subscribeToQuery(key, () => undefined, keepUnusedDataFor);
    const promise = runQuery(props, arg, { key, requestId });

    let didUnsubscribe = false;

    const unsubscribe = () => {
        if (didUnsubscribe) {
            return;
        }

        didUnsubscribe = true;
        unsubscribeFromQuery();
    };

    return {
        requestId,
        arg,
        promise,
        unwrap: () => promise,
        abort: () => {
            abortQueryByKey(key);
        },
        unsubscribe,
        refetch: () => runQuery(props, arg, { key, requestId: createRequestId() }),
    };
}
