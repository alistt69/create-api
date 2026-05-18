import { getInitialQueryState } from '../model/queryStore.js';
import {
    type ApiEndpointMutation,
    type ApiEndpointQuery,
    type InferMutationState,
    type InferQueryState,
    type MutationController,
    type MutationInitiateResult,
    type QueryController,
    type QueryInitiateResult,
    type QueryStateListener,
} from '../model/types.js';

export function createController<R, A>(
    endpoint: ApiEndpointQuery<R, A>,
): QueryController<R, A>;

export function createController<R, A>(
    endpoint: ApiEndpointMutation<R, A>,
): MutationController<R, A>;

export function createController<R, A>(
    endpoint: ApiEndpointQuery<R, A> | ApiEndpointMutation<R, A>,
): QueryController<R, A> | MutationController<R, A> {
    if (endpoint.type === 'query') {
        return createQueryController(endpoint);
    }

    return createMutationController(endpoint);
}

function createQueryController<R, A>(
    endpoint: ApiEndpointQuery<R, A>,
): QueryController<R, A> {
    let currentArg: A;
    let hasCurrentArg = false;
    let currentRequest: QueryInitiateResult<R, A> | undefined;
    let unsubscribeFromEndpoint: (() => void) | undefined;
    let state: InferQueryState<R> = getInitialQueryState<R>();
    const listeners = new Set<QueryStateListener>();

    const notifyListeners = () => {
        listeners.forEach((listener) => {
            listener();
        });
    };

    const subscribe = (listener: QueryStateListener) => {
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    };

    const syncState = () => {
        if (!hasCurrentArg) {
            return;
        }

        state = endpoint.select(currentArg);
        notifyListeners();
    };

    const disposeSubscription = () => {
        unsubscribeFromEndpoint?.();
        unsubscribeFromEndpoint = undefined;
    };

    return {
        get state() {
            return state;
        },

        run(arg: A) {
            currentArg = arg;
            hasCurrentArg = true;
            disposeSubscription();

            currentRequest?.unsubscribe();
            currentRequest = endpoint.initiate(arg);

            state = endpoint.select(arg);
            notifyListeners();

            unsubscribeFromEndpoint = endpoint.subscribe(arg, syncState);

            return currentRequest.unwrap();
        },

        refetch() {
            return currentRequest?.refetch();
        },

        abort() {
            currentRequest?.abort();
        },

        dispose() {
            disposeSubscription();
            currentRequest?.unsubscribe();
            currentRequest = undefined;
            hasCurrentArg = false;
            state = getInitialQueryState();
            notifyListeners();
            listeners.clear();
        },

        subscribe,
    };
}

function getInitialMutationState<R>(): InferMutationState<R> {
    return {
        data: undefined,
        error: undefined,
        isLoading: false,
    };
}

function createMutationController<R, A>(
    endpoint: ApiEndpointMutation<R, A>,
): MutationController<R, A> {
    let currentRequest: MutationInitiateResult<R, A> | undefined;
    let currentRequestId: string | undefined;
    let state: InferMutationState<R> = getInitialMutationState<R>();
    const listeners = new Set<QueryStateListener>();

    const notifyListeners = () => {
        listeners.forEach((listener) => {
            listener();
        });
    };

    const subscribe = (listener: QueryStateListener) => {
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    };

    const reset = () => {
        currentRequestId = undefined;
        state = getInitialMutationState<R>();
        notifyListeners();
    };

    return {
        get state() {
            return state;
        },

        async run(arg: A) {
            currentRequest?.abort();
            currentRequest = endpoint.initiate(arg);
            currentRequestId = currentRequest.requestId;
            const requestId = currentRequest.requestId;

            state = {
                data: undefined,
                error: undefined,
                isLoading: true,
            };

            notifyListeners();

            try {
                const data = await currentRequest.unwrap();

                if (currentRequestId === requestId) {
                    state = {
                        data,
                        error: undefined,
                        isLoading: false,
                    };

                    notifyListeners();
                }

                return data;
            }
            catch (error) {
                if (currentRequestId === requestId) {
                    state = {
                        data: undefined,
                        error,
                        isLoading: false,
                    };

                    notifyListeners();
                }

                throw error;
            }
        },

        abort() {
            currentRequest?.abort();
        },

        reset,

        dispose() {
            currentRequest?.abort();
            currentRequest = undefined;
            reset();
            listeners.clear();
        },

        subscribe,
    };
}
