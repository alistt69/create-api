import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    queryStore,
    queryRunners,
    queryListeners,
    queryTagsByKey,
    queryKeysByTag,
    queryGcTimeouts,
    inFlightQueries,
    refetchQueryByKey,
    queryTagResolvers,
    queryEndpointByKey,
    queryKeySerializers,
    queryKeysByEndpoint,
    queryAbortControllers,
    querySubscriptionsCount,
} from '../model/queryStore.js';
import { type BaseQueryArgs, createApi } from './createApi.js';
import { createController } from '../controller.js';
import { fetchBaseQuery } from './fetchBaseQuery.js';
import type { BaseQueryResult } from '../model/types.js';

interface Ticket {
    id: string;
    title: string;
}

interface TicketsListResponse {
    page: number;
    items: Ticket[];
    callNo: number;
    servedAt: string;
}

interface TicketDetailResponse {
    id: string;
    title: string;
    callNo: number;
    servedAt: string;
}

interface EditTicketResponse {
    ok: true;
    editCallNo: number;
    ticket: Ticket;
    servedAt: string;
}

function resetQueryStore() {
    queryGcTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    queryStore.clear();
    queryListeners.clear();
    inFlightQueries.clear();
    queryRunners.clear();
    queryKeysByEndpoint.clear();
    queryEndpointByKey.clear();
    queryKeysByTag.clear();
    queryTagsByKey.clear();
    querySubscriptionsCount.clear();
    queryGcTimeouts.clear();
    queryAbortControllers.clear();
    queryKeySerializers.clear();
    queryTagResolvers.clear();
}

function wait(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(resolve, ms);

        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timeoutId);
                reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
        );
    });
}

async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

function setupApi() {
    const db: { tickets: Ticket[] } = {
        tickets: [
            { id: '1', title: 'Alpha' },
            { id: '2', title: 'Beta' },
            { id: '3', title: 'Gamma' },
            { id: '4', title: 'Delta' },
            { id: '5', title: 'Epsilon' },
            { id: '6', title: 'Zeta' },
        ],
    };

    const listCallsByPage = new Map<number, number>();
    const detailCallsById = new Map<string, number>();
    let editCalls = 0;

    const inc = (map: Map<number | string, number>, key: number | string) => {
        const next = (map.get(key) ?? 0) + 1;
        map.set(key, next);
        return next;
    };

    const baseQuery = async (args: BaseQueryArgs): Promise<BaseQueryResult<unknown>> => {
        const { url, method = 'GET', params, body, signal } = args;

        if (url === '/tickets' && method === 'GET') {
            const page = Number(params?.page ?? 1);
            await wait(page === 1 ? 1000 : 300, signal);

            if (page === 13) {
                return {
                    error: {
                        status: 400,
                        data: { message: 'Page 13 is forced to fail' },
                    },
                };
            }

            const callNo = inc(listCallsByPage, page);
            const pageSize = 2;
            const startIndex = (page - 1) * pageSize;
            const items = db.tickets.slice(startIndex, startIndex + pageSize);

            return {
                data: {
                    page,
                    items,
                    callNo,
                    servedAt: new Date().toISOString(),
                } satisfies TicketsListResponse,
            };
        }

        if (url.startsWith('/tickets/') && method === 'GET') {
            const id = url.split('/').pop() ?? '';
            await wait(id === '2' ? 200 : 100, signal);

            const callNo = inc(detailCallsById, id);
            const ticket = db.tickets.find((item) => item.id === id);

            if (!ticket) {
                return {
                    error: {
                        status: 404,
                        data: { message: `Ticket ${id} not found` },
                    },
                };
            }

            return {
                data: {
                    ...ticket,
                    callNo,
                    servedAt: new Date().toISOString(),
                } satisfies TicketDetailResponse,
            };
        }

        if (url.startsWith('/tickets/') && method === 'PATCH') {
            const id = url.split('/').pop() ?? '';
            const payload = body as { title: string; delayMs?: number } | undefined;
            await wait(payload?.delayMs ?? 100, signal);

            const ticket = db.tickets.find((item) => item.id === id);

            if (!ticket) {
                return {
                    error: {
                        status: 404,
                        data: { message: `Ticket ${id} not found` },
                    },
                };
            }

            if (!payload?.title?.trim()) {
                return {
                    error: {
                        status: 400,
                        data: { message: 'Title is empty' },
                    },
                };
            }

            ticket.title = payload.title;
            editCalls += 1;

            return {
                data: {
                    ok: true,
                    editCallNo: editCalls,
                    ticket: { ...ticket },
                    servedAt: new Date().toISOString(),
                } satisfies EditTicketResponse,
            };
        }

        return {
            error: {
                status: 500,
                data: { message: `Unhandled request: ${method} ${url}` },
            },
        };
    };

    const api = createApi({
        baseQuery,
        endpoints: (builder) => ({
            getTickets: builder.query<TicketsListResponse, { page: number }>({
                query: (args) => ({ url: '/tickets', method: 'GET', params: args }),
                keepUnusedDataFor: 5000,
            }),
            getTicketById: builder.query<TicketDetailResponse, string>({
                query: (id) => ({ url: `/tickets/${id}`, method: 'GET' }),
                serializeArgs: (id) => id,
                staleTime: 2000,
                keepUnusedDataFor: 10000,
                providesTags: (_result, arg) => [`Ticket/${arg}`],
            }),
            getMissingTicket: builder.query<TicketDetailResponse, void>({
                query: () => ({ url: '/tickets/missing', method: 'GET' }),
            }),
            editTicket: builder.mutation<EditTicketResponse, { id: string; title: string; delayMs?: number }>({
                query: (payload) => ({ url: `/tickets/${payload.id}`, method: 'PATCH', body: payload }),
                invalidates: ['getTickets'],
                invalidatesTags: (_result, arg) => [`Ticket/${arg.id}`],
            }),
        }),
    });

    return { api, calls: { listCallsByPage, detailCallsById } };
}

describe('createApi core', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetQueryStore();
    });

    afterEach(() => {
        resetQueryStore();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('dedupes same query key across consumers', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        const second = renderHook(() => api.useGetTicketsQuery({ page: 1 }));

        expect(calls.listCallsByPage.get(1)).toBeUndefined();

        await advance(1000);

        expect(first.result.current.data?.callNo).toBe(1);
        expect(second.result.current.data?.callNo).toBe(1);
        expect(calls.listCallsByPage.get(1)).toBe(1);
    });

    it('does not refetch fresh cached data on remount before staleTime', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);
        expect(first.result.current.data?.callNo).toBe(1);

        first.unmount();
        await advance(1000);

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.data?.callNo).toBe(1);
        expect(second.result.current.isFetching).toBe(false);
        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('uses cached stale data immediately and background-refetches on remount after staleTime', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);
        expect(first.result.current.data?.callNo).toBe(1);

        first.unmount();
        await advance(4000);

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.data?.callNo).toBe(1);
        expect(second.result.current.isFetching).toBe(true);

        await advance(200);

        expect(second.result.current.data?.callNo).toBe(2);
        expect(second.result.current.isFetching).toBe(false);
        expect(calls.detailCallsById.get('2')).toBe(2);
    });

    it('drops cache after keepUnusedDataFor and performs initial load again', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);
        expect(first.result.current.data?.callNo).toBe(1);

        first.unmount();
        await advance(11000);

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.isLoading).toBe(true);
        expect(second.result.current.data).toBeUndefined();

        await advance(200);
        expect(second.result.current.data?.callNo).toBe(2);
        expect(calls.detailCallsById.get('2')).toBe(2);
    });

    it('lazy query keeps last visible state but allows older request to populate cache', async () => {
        const { api } = setupApi();

        const lazy = renderHook(() => api.useLazyGetTicketsQuery());

        act(() => {
            void lazy.result.current[0]({ page: 1 }).catch(() => undefined);
            void lazy.result.current[0]({ page: 2 }).catch(() => undefined);
        });

        await advance(300);
        expect(lazy.result.current[1].data?.page).toBe(2);
        expect(api.util.getQueryData<TicketsListResponse>('getTickets', { page: 1 })).toBeUndefined();

        await advance(700);
        expect(lazy.result.current[1].data?.page).toBe(2);
        expect(api.util.getQueryData<TicketsListResponse>('getTickets', { page: 1 })?.page).toBe(1);
        expect(api.util.getQueryData<TicketsListResponse>('getTickets', { page: 2 })?.page).toBe(2);
    });

    it('lazy query does not abort in-flight request on unmount', async () => {
        const { api } = setupApi();

        const lazy = renderHook(() => api.useLazyGetTicketsQuery());

        act(() => {
            void lazy.result.current[0]({ page: 1 });
        });

        lazy.unmount();
        await advance(1000);

        expect(api.util.getQueryData<TicketsListResponse>('getTickets', { page: 1 })?.page).toBe(1);
    });

    it('mutation state is latest-wins', async () => {
        const { api } = setupApi();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'slow', delayMs: 1000 }).catch(() => undefined);
            void mutation.result.current[0]({ id: '1', title: 'fast', delayMs: 200 }).catch(() => undefined);
        });

        await advance(200);
        expect(mutation.result.current[1].data?.ticket.title).toBe('fast');

        await advance(800);
        expect(mutation.result.current[1].data?.ticket.title).toBe('fast');
    });

    it('does not run query when enabled is false', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketByIdQuery('2', { enabled: false }));

        await advance(500);

        expect(query.result.current.data).toBeUndefined();
        expect(query.result.current.isLoading).toBe(false);
        expect(calls.detailCallsById.get('2')).toBeUndefined();
    });

    it('allows manual refetch when enabled is false', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketByIdQuery('2', { enabled: false }));

        await act(async () => {
            void query.result.current.refetch();
        });

        await advance(200);

        expect(query.result.current.data?.id).toBe('2');
        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('stores query error when baseQuery returns error', async () => {
        const { api } = setupApi();

        const query = renderHook(() => api.useGetTicketsQuery({ page: 13 }));

        await advance(1000);

        expect(query.result.current.data).toBeUndefined();
        expect(query.result.current.error).toEqual({
            status: 400,
            data: { message: 'Page 13 is forced to fail' },
        });
        expect(query.result.current.isLoading).toBe(false);
    });

    it('stores mutation error when mutation fails', async () => {
        const { api } = setupApi();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: '', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);

        expect(mutation.result.current[1].data).toBeUndefined();
        expect(mutation.result.current[1].error).toEqual({
            status: 400,
            data: { message: 'Title is empty' },
        });
    });

    it('resets mutation state', async () => {
        const { api } = setupApi();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'reset-me', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);

        expect(mutation.result.current[1].data?.ticket.title).toBe('reset-me');

        act(() => {
            mutation.result.current[1].reset();
        });

        expect(mutation.result.current[1].data).toBeUndefined();
        expect(mutation.result.current[1].error).toBeUndefined();
        expect(mutation.result.current[1].isLoading).toBe(false);
    });

    it('selects uninitialized query state before cache entry exists', () => {
        const { api } = setupApi();

        const state = api.endpoints.getTicketById.select('2');

        expect(state).toEqual({
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
        });
    });

    it('selects fulfilled query state after manual cache write', () => {
        const { api } = setupApi();

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '2', {
                id: '2',
                title: 'Selected Local',
                callNo: 999,
                servedAt: 'now',
            });
        });

        const state = api.endpoints.getTicketById.select('2');

        expect(state.data?.title).toBe('Selected Local');
        expect(state.status).toBe('fulfilled');
        expect(state.isUninitialized).toBe(false);
        expect(state.isSuccess).toBe(true);
        expect(state.isError).toBe(false);
        expect(state.isLoading).toBe(false);
        expect(state.isFetching).toBe(false);
        expect(state.error).toBeUndefined();
        expect(state.fulfilledAt).toEqual(expect.any(Number));
    });

    it('selects fulfilled query state after hook request succeeds', async () => {
        const { api } = setupApi();

        renderHook(() => api.useGetTicketByIdQuery('2'));

        await advance(200);

        const state = api.endpoints.getTicketById.select('2');

        expect(state.data?.id).toBe('2');
        expect(state.data?.title).toBe('Beta');
        expect(state.status).toBe('fulfilled');
        expect(state.isSuccess).toBe(true);
        expect(state.isLoading).toBe(false);
        expect(state.isFetching).toBe(false);
        expect(state.error).toBeUndefined();
    });

    it('initiates query and exposes fulfilled state through select', async () => {
        const { api } = setupApi();

        const request = api.endpoints.getTicketById.initiate('2');

        await advance(200);

        await expect(request.unwrap()).resolves.toMatchObject({
            id: '2',
            title: 'Beta',
        });

        const state = api.endpoints.getTicketById.select('2');

        expect(state.data?.id).toBe('2');
        expect(state.data?.title).toBe('Beta');
        expect(state.status).toBe('fulfilled');
        expect(state.isSuccess).toBe(true);
        expect(state.requestId).toBe(request.requestId);

        request.unsubscribe();
    });

    it('keeps initiated query cache until unsubscribe garbage collection finishes', async () => {
        const { api } = setupApi();

        const request = api.endpoints.getTicketById.initiate('2');

        await advance(200);

        expect(api.endpoints.getTicketById.select('2').data?.id).toBe('2');

        request.unsubscribe();

        await advance(9999);

        expect(api.endpoints.getTicketById.select('2').data?.id).toBe('2');

        await advance(1);

        expect(api.endpoints.getTicketById.select('2')).toEqual({
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
        });
    });

    it('allows initiated query unsubscribe to be called more than once', async () => {
        const { api } = setupApi();

        const request = api.endpoints.getTicketById.initiate('2');

        await advance(200);

        expect(api.endpoints.getTicketById.select('2').data?.id).toBe('2');

        request.unsubscribe();
        request.unsubscribe();

        await advance(9999);

        expect(api.endpoints.getTicketById.select('2').data?.id).toBe('2');

        await advance(1);

        expect(api.endpoints.getTicketById.select('2').isUninitialized).toBe(true);
    });

    it('refetches initiated query and updates cache state', async () => {
        const { api, calls } = setupApi();

        const request = api.endpoints.getTicketById.initiate('2');

        await advance(200);

        expect(api.endpoints.getTicketById.select('2').data?.callNo).toBe(1);
        expect(calls.detailCallsById.get('2')).toBe(1);

        const refetchPromise = request.refetch();

        await advance(200);

        await expect(refetchPromise).resolves.toMatchObject({
            id: '2',
            callNo: 2,
        });

        const state = api.endpoints.getTicketById.select('2');

        expect(state.data?.callNo).toBe(2);
        expect(state.status).toBe('fulfilled');
        expect(state.isSuccess).toBe(true);
        expect(calls.detailCallsById.get('2')).toBe(2);

        request.unsubscribe();
    });

    it('stores initiated query error and rejects unwrap', async () => {
        const { api } = setupApi();

        const request = api.endpoints.getTickets.initiate({ page: 13 });

        const unwrapExpectation = expect(request.unwrap()).rejects.toEqual({
            status: 400,
            data: { message: 'Page 13 is forced to fail' },
        });

        await advance(1000);

        await unwrapExpectation;

        const state = api.endpoints.getTickets.select({ page: 13 });

        expect(state.data).toBeUndefined();
        expect(state.error).toEqual({
            status: 400,
            data: { message: 'Page 13 is forced to fail' },
        });
        expect(state.status).toBe('rejected');
        expect(state.isError).toBe(true);
        expect(state.isSuccess).toBe(false);
        expect(state.requestId).toBe(request.requestId);

        request.unsubscribe();
    });

    it('aborts initiated query and leaves rejected state', async () => {
        const { api } = setupApi();

        const request = api.endpoints.getTickets.initiate({ page: 1 });

        const unwrapExpectation = expect(request.unwrap()).rejects.toMatchObject({
            name: 'AbortError',
        });

        request.abort();

        await unwrapExpectation;

        const state = api.endpoints.getTickets.select({ page: 1 });

        expect(state.status).toBe('rejected');
        expect(state.isError).toBe(true);
        expect(state.isLoading).toBe(false);
        expect(state.isFetching).toBe(false);
        expect(state.requestId).toBe(request.requestId);

        request.unsubscribe();
    });

    it('exposes initiated query promise', async () => {
        const { api } = setupApi();

        const request = api.endpoints.getTicketById.initiate('2');

        await advance(200);

        await expect(request.promise).resolves.toMatchObject({
            id: '2',
            title: 'Beta',
        });

        request.unsubscribe();
    });

    it('invalidates object tags through api util and refetches matching active query', async () => {
        const { api, calls } = setupApi();

        const request = api.endpoints.getTicketById.initiate('2');

        await advance(200);

        expect(api.endpoints.getTicketById.select('2').data?.callNo).toBe(1);
        expect(calls.detailCallsById.get('2')).toBe(1);

        const refetches = api.util.invalidateTags([{ type: 'Ticket', id: '2' }]);

        expect(refetches).toHaveLength(1);

        await advance(200);
        await Promise.all(refetches);

        expect(api.endpoints.getTicketById.select('2').data?.callNo).toBe(2);
        expect(calls.detailCallsById.get('2')).toBe(2);

        request.unsubscribe();
    });

    it('invalidates string tags through api util', async () => {
        const { api, calls } = setupApi();

        const request = api.endpoints.getTicketById.initiate('2');

        await advance(200);

        expect(calls.detailCallsById.get('2')).toBe(1);

        const refetches = api.util.invalidateTags(['Ticket/2']);

        expect(refetches).toHaveLength(1);

        await advance(200);
        await Promise.all(refetches);

        expect(api.endpoints.getTicketById.select('2').data?.callNo).toBe(2);
        expect(calls.detailCallsById.get('2')).toBe(2);

        request.unsubscribe();
    });

    it('subscribes to endpoint query state changes', async () => {
        const { api } = setupApi();

        const listener = vi.fn();
        const unsubscribe = api.endpoints.getTicketById.subscribe('2', listener);

        const request = api.endpoints.getTicketById.initiate('2');

        expect(listener).toHaveBeenCalledTimes(1);

        await advance(200);

        expect(listener).toHaveBeenCalled();

        const callsAfterFulfilled = listener.mock.calls.length;

        unsubscribe();

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '2', {
                id: '2',
                title: 'After unsubscribe',
                callNo: 999,
                servedAt: 'now',
            });
        });

        expect(listener).toHaveBeenCalledTimes(callsAfterFulfilled);

        request.unsubscribe();
    });

    it('creates controller that runs query and exposes state', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.getTicketById);

        expect(controller.state.isUninitialized).toBe(true);

        const promise = controller.run('2');

        expect(controller.state.status).toBe('pending');

        await advance(200);

        await expect(promise).resolves.toMatchObject({
            id: '2',
            title: 'Beta',
        });

        expect(controller.state.data?.id).toBe('2');
        expect(controller.state.data?.title).toBe('Beta');
        expect(controller.state.status).toBe('fulfilled');
        expect(controller.state.isSuccess).toBe(true);

        controller.dispose();

        expect(controller.state.isUninitialized).toBe(true);
    });

    it('updates controller state after void query rejects', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.getMissingTicket);

        const promise = controller.run(undefined);

        expect(controller.state.isLoading).toBe(true);

        const expectation = expect(promise).rejects.toMatchObject({
            status: 404,
        });

        await advance(100);

        await expectation;

        expect(controller.state.isLoading).toBe(false);
        expect(controller.state.isFetching).toBe(false);
        expect(controller.state.isError).toBe(true);
        expect(controller.state.error).toMatchObject({
            status: 404,
        });

        controller.dispose();
    });

    it('updates controller state after tag invalidation refetch', async () => {
        const { api, calls } = setupApi();

        const controller = createController(api.endpoints.getTicketById);

        const promise = controller.run('2');

        await advance(200);
        await promise;

        expect(controller.state.data?.callNo).toBe(1);
        expect(calls.detailCallsById.get('2')).toBe(1);

        const refetches = api.util.invalidateTags([{ type: 'Ticket', id: '2' }]);

        await advance(200);
        await Promise.all(refetches);

        expect(controller.state.data?.callNo).toBe(2);
        expect(calls.detailCallsById.get('2')).toBe(2);

        controller.dispose();
    });

    it('stops updating controller state after dispose', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.getTicketById);

        const promise = controller.run('2');

        await advance(200);
        await promise;

        expect(controller.state.data?.title).toBe('Beta');

        controller.dispose();

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '2', {
                id: '2',
                title: 'After dispose',
                callNo: 999,
                servedAt: 'now',
            });
        });

        expect(controller.state.isUninitialized).toBe(true);
        expect(controller.state.data).toBeUndefined();
    });

    it('initiates mutation imperatively', async () => {
        const { api } = setupApi();

        const request = api.endpoints.editTicket.initiate({
            id: '2',
            title: 'Updated from initiate',
        });

        await advance(200);

        await expect(request.unwrap()).resolves.toMatchObject({
            ok: true,
            ticket: {
                id: '2',
                title: 'Updated from initiate',
            },
        });

        expect(request.arg).toEqual({
            id: '2',
            title: 'Updated from initiate',
        });
        expect(request.requestId).toEqual(expect.any(String));
    });

    it('creates controller that runs mutation and exposes state', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.editTicket);

        expect(controller.state.isLoading).toBe(false);
        expect(controller.state.data).toBeUndefined();
        expect(controller.state.error).toBeUndefined();

        const promise = controller.run({
            id: '2',
            title: 'Updated from mutation controller',
        });

        expect(controller.state.isLoading).toBe(true);

        await advance(200);

        await expect(promise).resolves.toMatchObject({
            ok: true,
            ticket: {
                id: '2',
                title: 'Updated from mutation controller',
            },
        });

        expect(controller.state.isLoading).toBe(false);
        expect(controller.state.error).toBeUndefined();
        expect(controller.state.data?.ticket.title).toBe('Updated from mutation controller');

        controller.dispose();

        expect(controller.state.isLoading).toBe(false);
        expect(controller.state.data).toBeUndefined();
        expect(controller.state.error).toBeUndefined();
    });

    it('keeps latest mutation controller state when older run resolves later', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.editTicket);

        const firstPromise = controller.run({
            id: '2',
            title: 'Older mutation',
            delayMs: 500,
        });

        const firstError = firstPromise.catch((error) => error);

        const secondPromise = controller.run({
            id: '2',
            title: 'Latest mutation',
            delayMs: 100,
        });

        await advance(100);

        await expect(secondPromise).resolves.toMatchObject({
            ticket: {
                id: '2',
                title: 'Latest mutation',
            },
        });

        expect(controller.state.data?.ticket.title).toBe('Latest mutation');

        await advance(400);

        await expect(firstError).resolves.toBeDefined();

        expect(controller.state.data?.ticket.title).toBe('Latest mutation');

        controller.dispose();
    });

    it('stores mutation controller error when run fails', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.editTicket);

        const promise = controller.run({
            id: 'missing',
            title: 'Nothing',
        });

        const errorPromise = promise.catch((error) => error);

        expect(controller.state.isLoading).toBe(true);

        await advance(200);

        await expect(errorPromise).resolves.toEqual({
            status: 404,
            data: { message: 'Ticket missing not found' },
        });

        expect(controller.state.isLoading).toBe(false);
        expect(controller.state.data).toBeUndefined();
        expect(controller.state.error).toEqual({
            status: 404,
            data: { message: 'Ticket missing not found' },
        });

        controller.dispose();
    });

    it('refetches query controller after mutation controller invalidates matching tag', async () => {
        const { api, calls } = setupApi();

        const ticketController = createController(api.endpoints.getTicketById);
        const editController = createController(api.endpoints.editTicket);

        const queryPromise = ticketController.run('2');

        await advance(200);
        await queryPromise;

        expect(ticketController.state.data?.title).toBe('Beta');
        expect(ticketController.state.data?.callNo).toBe(1);
        expect(calls.detailCallsById.get('2')).toBe(1);

        const mutationPromise = editController.run({
            id: '2',
            title: 'Updated through mutation controller',
        });

        await advance(200);

        await expect(mutationPromise).resolves.toMatchObject({
            ticket: {
                id: '2',
                title: 'Updated through mutation controller',
            },
        });

        await advance(200);

        expect(ticketController.state.data?.title).toBe('Updated through mutation controller');
        expect(ticketController.state.data?.callNo).toBe(2);
        expect(calls.detailCallsById.get('2')).toBe(2);

        editController.dispose();
        ticketController.dispose();
    });

    it('supports util setQueryData and updateQueryData', async () => {
        const { api } = setupApi();

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '2', {
                id: '2',
                title: 'Local',
                callNo: 999,
                servedAt: 'now',
            });
        });

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.title).toBe('Local');

        act(() => {
            api.util.updateQueryData<TicketDetailResponse>('getTicketById', '2', (prev) => ({
                ...prev!,
                title: 'Updated Local',
            }));
        });

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.title).toBe('Updated Local');
    });

    it('supports blob response via custom responseHandler', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response(bytes, {
                status: 200,
                headers: { 'content-type': 'application/octet-stream' },
            })) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/file',
            responseHandler: (response) => response.blob(),
        });

        expect('data' in result).toBe(true);

        if ('data' in result) {
            const blobLike = result.data as Blob;
            expect(typeof blobLike.arrayBuffer).toBe('function');
            expect(blobLike.size).toBe(4);
            expect(blobLike.type).toBe('application/octet-stream');
        }
    });

    it('content-type responseHandler falls back to text for non-json binary content', async () => {
        const bytes = new Uint8Array([65, 66, 67]);

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response(bytes, {
                status: 200,
                headers: { 'content-type': 'application/octet-stream' },
            })) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/binary',
            responseHandler: 'content-type',
        });

        expect('data' in result).toBe(true);

        if ('data' in result) {
            expect(typeof result.data).toBe('string');
        }
    });

    it('notifies query controller subscribers when state changes', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.getTicketById);
        const listener = vi.fn();

        const unsubscribe = controller.subscribe(listener);

        const promise = controller.run('2');

        expect(listener).toHaveBeenCalled();
        expect(controller.state.isLoading).toBe(true);

        await advance(200);
        await promise;

        expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(controller.state.data?.id).toBe('2');

        const callsAfterUnsubscribe = listener.mock.calls.length;

        unsubscribe();

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '2', {
                id: '2',
                title: 'After unsubscribe',
                callNo: 999,
                servedAt: 'now',
            });
        });

        expect(listener).toHaveBeenCalledTimes(callsAfterUnsubscribe);

        controller.dispose();
    });

    it('notifies mutation controller subscribers when state changes', async () => {
        const { api } = setupApi();

        const controller = createController(api.endpoints.editTicket);
        const listener = vi.fn();

        const unsubscribe = controller.subscribe(listener);

        const promise = controller.run({
            id: '2',
            title: 'Updated through subscribed mutation controller',
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(controller.state.isLoading).toBe(true);

        await advance(200);
        await promise;

        expect(listener).toHaveBeenCalledTimes(2);
        expect(controller.state.isLoading).toBe(false);
        expect(controller.state.data?.ticket.title).toBe('Updated through subscribed mutation controller');

        unsubscribe();

        controller.reset();

        expect(listener).toHaveBeenCalledTimes(2);
        expect(controller.state.data).toBeUndefined();

        controller.dispose();
    });

    it('does not json-stringify Blob body', async () => {
        const bodyBlob = new Blob(['hello'], { type: 'text/plain' });

        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(String(input)).toBe('https://api.example.com/upload-blob');
            expect(init?.headers).toBeDefined();

            const headers = new Headers(init?.headers);
            expect(headers.get('content-type')).not.toBe('application/json');

            expect(init?.body).toBe(bodyBlob);

            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
        });

        const result = await baseQuery({
            url: '/upload-blob',
            method: 'POST',
            body: bodyBlob,
        });

        expect('data' in result && result.data).toEqual({ ok: true });
    });

    it('lazy query transforms error response only once', async () => {
        const transformErrorResponse = vi.fn((error) => ({
            wrapped: error,
        }));

        const api = createApi({
            baseQuery: async () => ({
                error: { status: 500, data: { message: 'fail' } },
            }),
            endpoints: (builder) => ({
                getBroken: builder.query<unknown, string>({
                    query: (id) => ({ url: `/broken/${id}` }),
                    transformErrorResponse,
                }),
            }),
        });

        const lazy = renderHook(() => api.useLazyGetBrokenQuery());

        await act(async () => {
            await expect(lazy.result.current[0]('1')).rejects.toEqual({
                wrapped: { status: 500, data: { message: 'fail' } },
            });
        });

        expect(transformErrorResponse).toHaveBeenCalledTimes(1);
        expect(lazy.result.current[1].error).toEqual({
            wrapped: { status: 500, data: { message: 'fail' } },
        });
    });

    it('setQueryData refreshes cache freshness and notifies subscribers', async () => {
        vi.useFakeTimers();
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);

        expect(first.result.current.data?.callNo).toBe(1);

        await advance(3000); // staleTime = 2000

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '2', {
                id: '2',
                title: 'Local Fresh',
                callNo: 999,
                servedAt: 'local',
            });
        });

        expect(first.result.current.data?.title).toBe('Local Fresh');
        expect(first.result.current.data?.callNo).toBe(999);

        first.unmount();

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.data?.title).toBe('Local Fresh');
        expect(second.result.current.isFetching).toBe(false);
        expect(calls.detailCallsById.get('2')).toBe(1);

        await advance(200);

        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('invalidates unused cached queries kept by keepUnusedDataFor', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        await advance(1000);

        expect(query.result.current.data?.callNo).toBe(1);

        query.unmount();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'After Mutation', delayMs: 100 });
        });

        await advance(100);
        await advance(1000);
        expect(calls.listCallsByPage.get(1)).toBe(2);

        const remounted = renderHook(() => api.useGetTicketsQuery({ page: 1 }));

        expect(remounted.result.current.data?.callNo).toBe(2);
        expect(remounted.result.current.data?.items[0]?.title).toBe('After Mutation');
    });

    it('keeps query runner bound to the original arg snapshot for old cache keys', async () => {
        const { api } = setupApi();

        const query = renderHook(
            ({ id }) => api.useGetTicketByIdQuery(id),
            { initialProps: { id: '1' } },
        );

        await advance(100);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');

        query.rerender({ id: '2' });
        await advance(200);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');

        act(() => {
            void query.result.current.refetch();
        });

        await advance(200);

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');
    });

    it('setQueryData refreshes cache freshness and notifies subscribers', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);
        expect(first.result.current.data?.callNo).toBe(1);

        await advance(3000);

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '2', {
                id: '2',
                title: 'Local Fresh',
                callNo: 999,
                servedAt: 'local',
            });
        });

        expect(first.result.current.data?.title).toBe('Local Fresh');
        expect(first.result.current.data?.callNo).toBe(999);

        first.unmount();

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.data?.title).toBe('Local Fresh');
        expect(second.result.current.isFetching).toBe(false);
        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('does not populate disabled query from mutation invalidation', async () => {
        const { api, calls } = setupApi();

        const disabledQuery = renderHook(() => api.useGetTicketsQuery({ page: 1 }, { enabled: false }));
        expect(disabledQuery.result.current.data).toBeUndefined();
        expect(calls.listCallsByPage.get(1)).toBeUndefined();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBeUndefined();
        expect(disabledQuery.result.current.data).toBeUndefined();
        expect(disabledQuery.result.current.isLoading).toBe(false);
        expect(disabledQuery.result.current.isFetching).toBe(false);
    });

    it('invalidates unused cached queries kept by keepUnusedDataFor', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        await advance(1000);
        expect(query.result.current.data?.callNo).toBe(1);

        query.unmount();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'After Mutation', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(2);

        const remounted = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        expect(remounted.result.current.data?.callNo).toBe(2);
        expect(remounted.result.current.data?.items[0]?.title).toBe('After Mutation');
    });

    it('keeps query runner bound to the original arg snapshot for old cache keys', async () => {
        const { api } = setupApi();

        const query = renderHook(
            ({ id }) => api.useGetTicketByIdQuery(id),
            { initialProps: { id: '1' } },
        );

        await advance(100);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');

        query.rerender({ id: '2' });
        await advance(200);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');

        act(() => {
            void refetchQueryByKey('getTicketById::1');
        });

        await advance(100);

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');
    });

    it('registers runnable query again when enabled switches from false to true', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(
            ({ enabled }) => api.useGetTicketsQuery({ page: 1 }, { enabled }),
            { initialProps: { enabled: false } },
        );

        expect(calls.listCallsByPage.get(1)).toBeUndefined();

        query.rerender({ enabled: true });
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(1);
        expect(query.result.current.data?.page).toBe(1);
    });

    it('stops invalidation-driven refetch after query becomes disabled', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(
            ({ enabled }) => api.useGetTicketsQuery({ page: 1 }, { enabled }),
            { initialProps: { enabled: true } },
        );

        await advance(1000);
        expect(calls.listCallsByPage.get(1)).toBe(1);

        query.rerender({ enabled: false });

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(1);
    });

    it('lazy aborted request does not write error state after unmount', async () => {
        const { api } = setupApi();

        const lazy = renderHook(() => api.useLazyGetTicketsQuery());

        act(() => {
            void lazy.result.current[0]({ page: 1 }).catch(() => undefined);
        });

        lazy.unmount();
        await advance(1000);

        expect(api.util.getQueryData<TicketsListResponse>('getTickets', { page: 1 })?.page).toBe(1);
    });

    it('does not populate disabled query from endpoint invalidation', async () => {
        const { api, calls } = setupApi();

        const disabledQuery = renderHook(() => api.useGetTicketsQuery({ page: 1 }, { enabled: false }));
        expect(disabledQuery.result.current.data).toBeUndefined();
        expect(calls.listCallsByPage.get(1)).toBeUndefined();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBeUndefined();
        expect(disabledQuery.result.current.data).toBeUndefined();
        expect(disabledQuery.result.current.isLoading).toBe(false);
        expect(disabledQuery.result.current.isFetching).toBe(false);
    });

    it('does not populate disabled query from tag invalidation', async () => {
        const { api, calls } = setupApi();

        const disabledQuery = renderHook(() => api.useGetTicketByIdQuery('1', { enabled: false }));
        expect(disabledQuery.result.current.data).toBeUndefined();
        expect(calls.detailCallsById.get('1')).toBeUndefined();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated by Tag', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(100);

        expect(calls.detailCallsById.get('1')).toBeUndefined();
        expect(disabledQuery.result.current.data).toBeUndefined();
        expect(disabledQuery.result.current.isLoading).toBe(false);
        expect(disabledQuery.result.current.isFetching).toBe(false);
    });

    it('becomes runnable again when enabled switches from false to true', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(
            ({ enabled }) => api.useGetTicketsQuery({ page: 1 }, { enabled }),
            { initialProps: { enabled: false } },
        );

        expect(calls.listCallsByPage.get(1)).toBeUndefined();

        query.rerender({ enabled: true });
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(1);
        expect(query.result.current.data?.page).toBe(1);
    });

    it('stops invalidation-driven refetch after query becomes disabled', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(
            ({ enabled }) => api.useGetTicketsQuery({ page: 1 }, { enabled }),
            { initialProps: { enabled: true } },
        );

        await advance(1000);
        expect(calls.listCallsByPage.get(1)).toBe(1);

        query.rerender({ enabled: false });

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(1);
    });

    it('keeps query runner bound to the original arg snapshot for old cache keys', async () => {
        const { api } = setupApi();

        const query = renderHook(
            ({ id }) => api.useGetTicketByIdQuery(id),
            { initialProps: { id: '1' } },
        );

        await advance(100);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');

        query.rerender({ id: '2' });
        await advance(200);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');

        act(() => {
            void refetchQueryByKey('getTicketById::1');
        });

        await advance(100);

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');
    });

    it('old key refetch keeps old key tags bound to original arg snapshot', async () => {
        const { api } = setupApi();

        const query = renderHook(
            ({ id }) => api.useGetTicketByIdQuery(id),
            { initialProps: { id: '1' } },
        );

        await advance(100);

        query.rerender({ id: '2' });
        await advance(200);

        act(() => {
            void refetchQueryByKey('getTicketById::1');
        });

        await advance(100);

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Tag Check', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(100);

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');
    });

    it('old key refetch keeps error transform bound to original arg snapshot', async () => {
        const seenArgs: string[] = [];

        const api = createApi({
            baseQuery: async () => ({
                error: { status: 500, data: { message: 'fail' } },
            }),
            endpoints: (builder) => ({
                getBroken: builder.query<unknown, string>({
                    query: (id) => ({ url: `/broken/${id}` }),
                    serializeArgs: (id) => id,
                    transformErrorResponse: (error, arg) => {
                        seenArgs.push(arg);
                        return { arg, error };
                    },
                    keepUnusedDataFor: 10000,
                }),
            }),
        });

        const query = renderHook(
            ({ id }) => api.useGetBrokenQuery(id),
            { initialProps: { id: '1' } },
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(seenArgs).toContain('1');

        query.rerender({ id: '2' });

        await act(async () => {
            await Promise.resolve();
        });

        seenArgs.length = 0;

        await act(async () => {
            await refetchQueryByKey('getBroken::1')?.catch(() => undefined);
        });

        expect(seenArgs).toEqual(['1']);
    });

    it('cancels scheduled cleanup when query remounts before keepUnusedDataFor expires', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);
        expect(first.result.current.data?.callNo).toBe(1);

        first.unmount();
        await advance(5000);

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));
        expect(second.result.current.data?.callNo).toBe(1);
        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('does not cleanup cache while another subscriber is still mounted', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        await advance(200);
        expect(first.result.current.data?.callNo).toBe(1);
        expect(second.result.current.data?.callNo).toBe(1);

        first.unmount();
        await advance(11000);

        expect(second.result.current.data?.callNo).toBe(1);
        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('does not refetch query by endpoint after cache entry was garbage collected', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        await advance(1000);
        expect(query.result.current.data?.callNo).toBe(1);

        query.unmount();
        await advance(6000);

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'After GC', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(1);
    });

    it('updateQueryData refreshes cache freshness and prevents stale remount refetch', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);

        await advance(3000);

        act(() => {
            api.util.updateQueryData<TicketDetailResponse>('getTicketById', '2', (prev) => ({
                ...prev!,
                title: 'Updated Fresh',
            }));
        });

        first.unmount();

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.data?.title).toBe('Updated Fresh');
        expect(second.result.current.isFetching).toBe(false);
        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('setQueryData updates tags used by tag invalidation for an existing query key', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketByIdQuery('1'));
        await advance(100);
        expect(calls.detailCallsById.get('1')).toBe(1);

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '1', {
                id: '1',
                title: 'Local Tagged',
                callNo: 999,
                servedAt: 'now',
            });
        });

        query.unmount();

        const mutation = renderHook(() => api.useEditTicketMutation());

        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Retagged', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(100);

        expect(calls.detailCallsById.get('1')).toBe(2);
    });

    it('old key refetch does not write newer arg result into older cache key', async () => {
        const { api } = setupApi();

        const query = renderHook(
            ({ id }) => api.useGetTicketByIdQuery(id),
            { initialProps: { id: '1' } },
        );

        await advance(100);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.id).toBe('1');

        query.rerender({ id: '2' });
        await advance(200);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.id).toBe('2');

        act(() => {
            void refetchQueryByKey('getTicketById::1');
        });
        await advance(100);

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')).toMatchObject({ id: '1' });
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')).toMatchObject({ id: '2' });
    });

    it('old key refetch keeps old entity payload under old cache key', async () => {
        const { api } = setupApi();

        const query = renderHook(
            ({ id }) => api.useGetTicketByIdQuery(id),
            { initialProps: { id: '1' } },
        );

        await advance(100);
        const firstTitle = api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.title;

        query.rerender({ id: '2' });
        await advance(200);
        const secondTitle = api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.title;

        act(() => {
            void refetchQueryByKey('getTicketById::1');
        });
        await advance(100);

        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '1')?.title).toBe(firstTitle);
        expect(api.util.getQueryData<TicketDetailResponse>('getTicketById', '2')?.title).toBe(secondTitle);
    });

    it('disabled query stays empty after endpoint invalidation', async () => {
        const { api, calls } = setupApi();

        const disabledQuery = renderHook(() => api.useGetTicketsQuery({ page: 1 }, { enabled: false }));
        expect(disabledQuery.result.current.data).toBeUndefined();

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBeUndefined();
        expect(disabledQuery.result.current.data).toBeUndefined();
    });

    it('disabled query stays empty after tag invalidation', async () => {
        const { api, calls } = setupApi();

        const disabledQuery = renderHook(() => api.useGetTicketByIdQuery('1', { enabled: false }));
        expect(disabledQuery.result.current.data).toBeUndefined();

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated by Tag', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(100);

        expect(calls.detailCallsById.get('1')).toBeUndefined();
        expect(disabledQuery.result.current.data).toBeUndefined();
    });

    it('garbage-collected query is not refetched by later invalidation', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        await advance(1000);
        expect(calls.listCallsByPage.get(1)).toBe(1);

        query.unmount();
        await advance(6000);

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'After GC', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(1);
    });

    it('remount before GC preserves previous cache instead of initial loading', async () => {
        const { api } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);
        expect(first.result.current.data?.callNo).toBe(1);

        first.unmount();
        await advance(5000);

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.data?.callNo).toBe(1);
        expect(second.result.current.isLoading).toBe(false);
    });

    it('updateQueryData keeps cache fresh on remount', async () => {
        const { api, calls } = setupApi();

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(200);
        await advance(3000); // staleTime = 2000

        act(() => {
            api.util.updateQueryData<TicketDetailResponse>('getTicketById', '2', (prev) => ({
                ...prev!,
                title: 'Fresh Updated',
            }));
        });

        first.unmount();

        const second = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(second.result.current.data?.title).toBe('Fresh Updated');
        expect(second.result.current.isFetching).toBe(false);
        expect(calls.detailCallsById.get('2')).toBe(1);
    });

    it('unused cache invalidation updates remounted data payload', async () => {
        const { api } = setupApi();

        const query = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        await advance(1000);
        expect(query.result.current.data?.items[0]?.title).toBe('Alpha');

        query.unmount();

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Alpha Updated', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        const remounted = renderHook(() => api.useGetTicketsQuery({ page: 1 }));
        expect(remounted.result.current.data?.items[0]?.title).toBe('Alpha Updated');
    });

    it('keeps previous data when background refetch fails', async () => {
        let shouldFail = false;

        const api = createApi({
            baseQuery: async (args: BaseQueryArgs) => {
                if (args.url === '/ticket/2') {
                    await wait(100, args.signal);

                    if (shouldFail) {
                        return {
                            error: {
                                status: 500,
                                data: { message: 'refetch failed' },
                            },
                        };
                    }

                    return {
                        data: {
                            id: '2',
                            title: 'Alpha',
                            callNo: 1,
                            servedAt: 't1',
                        } satisfies TicketDetailResponse,
                    };
                }

                return {
                    error: {
                        status: 500,
                        data: { message: 'unexpected request' },
                    },
                };
            },
            endpoints: (builder) => ({
                getTicketById: builder.query<TicketDetailResponse, string>({
                    query: (id) => ({ url: `/ticket/${id}`, method: 'GET' }),
                    serializeArgs: (id) => id,
                    staleTime: 2000,
                    keepUnusedDataFor: 10000,
                }),
            }),
        });

        const query = renderHook(() => api.useGetTicketByIdQuery('2'));

        await advance(100);

        expect(query.result.current.data).toEqual({
            id: '2',
            title: 'Alpha',
            callNo: 1,
            servedAt: 't1',
        });
        expect(query.result.current.error).toBeUndefined();

        shouldFail = true;

        query.unmount();
        await advance(3000);

        const remounted = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(remounted.result.current.data?.title).toBe('Alpha');
        expect(remounted.result.current.isFetching).toBe(true);

        await advance(100);

        expect(remounted.result.current.data?.title).toBe('Alpha');
        expect(remounted.result.current.error).toEqual({
            status: 500,
            data: { message: 'refetch failed' },
        });
        expect(remounted.result.current.isFetching).toBe(false);
    });

    it('keeps previous data when background refetch fails', async () => {
        let shouldFail = false;

        const api = createApi({
            baseQuery: async (args: BaseQueryArgs) => {
                if (args.url === '/ticket/2') {
                    await wait(100, args.signal);

                    if (shouldFail) {
                        return {
                            error: {
                                status: 500,
                                data: { message: 'refetch failed' },
                            },
                        };
                    }

                    return {
                        data: {
                            id: '2',
                            title: 'Alpha',
                            callNo: 1,
                            servedAt: 't1',
                        } satisfies TicketDetailResponse,
                    };
                }

                return {
                    error: {
                        status: 500,
                        data: { message: 'unexpected request' },
                    },
                };
            },
            endpoints: (builder) => ({
                getTicketById: builder.query<TicketDetailResponse, string>({
                    query: (id) => ({ url: `/ticket/${id}`, method: 'GET' }),
                    serializeArgs: (id) => id,
                    staleTime: 2000,
                    keepUnusedDataFor: 10000,
                }),
            }),
        });

        const first = renderHook(() => api.useGetTicketByIdQuery('2'));
        await advance(100);

        expect(first.result.current.data?.title).toBe('Alpha');
        expect(first.result.current.error).toBeUndefined();

        shouldFail = true;

        first.unmount();
        await advance(3000);

        const remounted = renderHook(() => api.useGetTicketByIdQuery('2'));

        expect(remounted.result.current.data?.title).toBe('Alpha');
        expect(remounted.result.current.isFetching).toBe(true);

        await advance(100);

        expect(remounted.result.current.data?.title).toBe('Alpha');
        expect(remounted.result.current.error).toEqual({
            status: 500,
            data: { message: 'refetch failed' },
        });
        expect(remounted.result.current.isFetching).toBe(false);
    });

    it('lazy query keeps previous data when refetch fails', async () => {
        let shouldFail = false;

        const api = createApi({
            baseQuery: async (args: BaseQueryArgs) => {
                if (args.url === '/ticket/2') {
                    await wait(100, args.signal);

                    if (shouldFail) {
                        return {
                            error: {
                                status: 500,
                                data: { message: 'lazy refetch failed' },
                            },
                        };
                    }

                    return {
                        data: {
                            id: '2',
                            title: 'Alpha',
                            callNo: 1,
                            servedAt: 't1',
                        } satisfies TicketDetailResponse,
                    };
                }

                return {
                    error: {
                        status: 500,
                        data: { message: 'unexpected request' },
                    },
                };
            },
            endpoints: (builder) => ({
                getTicketById: builder.query<TicketDetailResponse, string>({
                    query: (id) => ({ url: `/ticket/${id}`, method: 'GET' }),
                    serializeArgs: (id) => id,
                    keepUnusedDataFor: 10000,
                }),
            }),
        });

        const lazy = renderHook(() => api.useLazyGetTicketByIdQuery());

        act(() => {
            void lazy.result.current[0]('2').catch(() => undefined);
        });
        await advance(100);

        expect(lazy.result.current[1].data?.title).toBe('Alpha');

        shouldFail = true;

        act(() => {
            void lazy.result.current[1].refetch()?.catch(() => undefined);
        });
        await advance(100);

        expect(lazy.result.current[1].data?.title).toBe('Alpha');
        expect(lazy.result.current[1].error).toEqual({
            status: 500,
            data: { message: 'lazy refetch failed' },
        });
    });

    it('endpoint invalidation skips disabled query keys without producing network calls', async () => {
        const { api, calls } = setupApi();

        renderHook(() => api.useGetTicketsQuery({ page: 1 }, { enabled: false }));

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBeUndefined();
    });

    it('external abort is reported as fetch error rather than timeout', async () => {
        const controller = new AbortController();

        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const request = input as Request;
            const signal = init?.signal ?? request.signal;

            return new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
        });

        const promise = baseQuery({
            url: '/abort',
            signal: controller.signal,
        });

        controller.abort();

        await expect(promise).resolves.toEqual({
            error: {
                status: 'FETCH_ERROR',
                error: 'AbortError: Aborted',
            },
        });
    });

    it('re-enables endpoint invalidation after query switches from disabled to enabled', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(
            ({ enabled }) => api.useGetTicketsQuery({ page: 1 }, { enabled }),
            { initialProps: { enabled: false } },
        );

        expect(calls.listCallsByPage.get(1)).toBeUndefined();

        query.rerender({ enabled: true });
        await advance(1000);
        expect(calls.listCallsByPage.get(1)).toBe(1);

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'After Enable', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(2);
    });

    it('stops endpoint invalidation after query switches from enabled to disabled', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(
            ({ enabled }) => api.useGetTicketsQuery({ page: 1 }, { enabled }),
            { initialProps: { enabled: true } },
        );

        await advance(1000);
        expect(calls.listCallsByPage.get(1)).toBe(1);

        query.rerender({ enabled: false });

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'After Disable', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(1000);

        expect(calls.listCallsByPage.get(1)).toBe(1);
        expect(query.result.current.data?.page).toBe(1);
    });

    it('tag invalidation refetches unused cached query before garbage collection', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketByIdQuery('1'));
        await advance(100);
        expect(calls.detailCallsById.get('1')).toBe(1);

        query.unmount();

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Updated by Tag', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(100);

        expect(calls.detailCallsById.get('1')).toBe(2);

        const remounted = renderHook(() => api.useGetTicketByIdQuery('1'));
        expect(remounted.result.current.data?.title).toBe('Updated by Tag');
    });

    it('tag invalidation does not refetch query after cache entry was garbage collected', async () => {
        const { api, calls } = setupApi();

        const query = renderHook(() => api.useGetTicketByIdQuery('1'));
        await advance(100);
        expect(calls.detailCallsById.get('1')).toBe(1);

        query.unmount();
        await advance(11000);

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'After GC Tag', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(100);

        expect(calls.detailCallsById.get('1')).toBe(1);
    });

    it('disabled tagged query stays non-runnable after manual cache write', async () => {
        const { api, calls } = setupApi();

        const disabledQuery = renderHook(() => api.useGetTicketByIdQuery('1', { enabled: false }));

        act(() => {
            api.util.setQueryData<TicketDetailResponse>('getTicketById', '1', {
                id: '1',
                title: 'Local Disabled',
                callNo: 999,
                servedAt: 'now',
            });
        });

        expect(disabledQuery.result.current.data?.title).toBe('Local Disabled');
        expect(calls.detailCallsById.get('1')).toBeUndefined();

        const mutation = renderHook(() => api.useEditTicketMutation());
        act(() => {
            void mutation.result.current[0]({ id: '1', title: 'Mutated Tag', delayMs: 100 }).catch(() => undefined);
        });

        await advance(100);
        await advance(100);

        expect(calls.detailCallsById.get('1')).toBeUndefined();
        expect(disabledQuery.result.current.data?.title).toBe('Local Disabled');
    });
});

describe('fetchBaseQuery', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('returns data and meta for successful json response', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(String(input)).toBe('https://api.example.com/tickets?page=2&search=bug');
            expect(init?.method).toBe('GET');

            return new Response(
                JSON.stringify({ ok: true, items: [{ id: '1', title: 'Alpha' }] }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            );
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
        });

        const result = await baseQuery({
            url: '/tickets',
            params: { page: 2, search: 'bug' },
        });

        expect(result).toHaveProperty('data');
        if ('data' in result) {
            expect(result.data).toEqual({
                ok: true,
                items: [{ id: '1', title: 'Alpha' }],
            });
            expect(result.meta?.request.url).toBe('https://api.example.com/tickets?page=2&search=bug');
        }

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('passes credentials from base query options to fetch', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.credentials).toBe('include');

            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            credentials: 'include',
            fetchFn: fetchMock as typeof fetch,
        });

        const result = await baseQuery({
            url: '/session',
        });

        expect(result).toHaveProperty('data');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.meta?.request.credentials).toBe('include');
    });

    it('allows request credentials to override base query credentials', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.credentials).toBe('omit');

            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            credentials: 'include',
            fetchFn: fetchMock as typeof fetch,
        });

        const result = await baseQuery({
            url: '/public',
            credentials: 'omit',
        });

        expect(result).toHaveProperty('data');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.meta?.request.credentials).toBe('omit');
    });

    it('returns http error object for non-2xx response', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response(
                JSON.stringify({ message: 'Not found' }),
                {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                },
            )) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/tickets/999',
        });

        expect(result).toEqual({
            error: {
                status: 404,
                data: { message: 'Not found' },
            },
            meta: expect.objectContaining({
                request: expect.any(Request),
                response: expect.any(Response),
            }),
        });
    });

    it('applies prepareHeaders and serializes json body', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(String(input)).toBe('https://api.example.com/tickets/1');

            const headers = new Headers(init?.headers);
            expect(headers.get('authorization')).toBe('Bearer token');
            expect(headers.get('content-type')).toBe('application/json');
            expect(init?.body).toBe(JSON.stringify({ title: 'Updated' }));

            return new Response(
                JSON.stringify({ ok: true }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            );
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
            prepareHeaders: (headers) => {
                headers.set('authorization', 'Bearer token');
                return headers;
            },
        });

        const result = await baseQuery({
            url: '/tickets/1',
            method: 'PATCH',
            body: { title: 'Updated' },
        });

        expect(result).toHaveProperty('data');
        if ('data' in result) {
            expect(result.data).toEqual({ ok: true });
        }
    });

    it('returns parsing error when json parsing fails', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response(
                'not-json',
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            )) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/broken',
        });

        expect(result).toEqual({
            error: expect.objectContaining({
                status: 'PARSING_ERROR',
                originalStatus: 200,
                data: 'not-json',
            }),
            meta: expect.objectContaining({
                request: expect.any(Request),
                response: expect.any(Response),
            }),
        });
    });

    it('returns timeout error when request exceeds timeout', async () => {
        vi.useFakeTimers();

        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const request = input as Request;
            const signal = init?.signal ?? request.signal;

            return new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
            timeout: 100,
        });

        const promise = baseQuery({
            url: '/slow',
        });

        await advance(100);

        await expect(promise).resolves.toEqual({
            error: {
                status: 'TIMEOUT_ERROR',
                error: 'Request timed out',
            },
        });
    });

    it('returns fetch error when fetch throws', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => {
                throw new TypeError('Failed to fetch');
            }) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/offline',
        });

        expect(result).toEqual({
            error: {
                status: 'FETCH_ERROR',
                error: 'Failed to fetch',
            },
        });
    });

    it('returns null data for 204 no content', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch,
        });

        const result = await baseQuery({ url: '/empty' });

        expect(result).toEqual({
            data: null,
            meta: expect.objectContaining({
                request: expect.any(Request),
                response: expect.any(Response),
            }),
        });
    });

    it('parses text response when responseHandler is text', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response('plain-text', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            })) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/text',
            responseHandler: 'text',
        });

        expect('data' in result && result.data).toBe('plain-text');
    });

    it('uses content-type response handler', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json; charset=utf-8' },
            })) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/auto',
            responseHandler: 'content-type',
        });

        expect('data' in result && result.data).toEqual({ ok: true });
    });

    it('supports custom responseHandler', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response('abc', { status: 200 })) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/custom',
            responseHandler: async (response) => (await response.text()).toUpperCase(),
        });

        expect('data' in result && result.data).toBe('ABC');
    });

    it('returns error when validateStatus returns false for 200 response', async () => {
        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: vi.fn(async () => new Response(JSON.stringify({ success: false }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch,
        });

        const result = await baseQuery({
            url: '/weird',
            validateStatus: (_response, body) => (body as { success?: boolean }).success === true,
        });

        expect(result).toEqual({
            error: {
                status: 200,
                data: { success: false },
            },
            meta: expect.objectContaining({
                request: expect.any(Request),
                response: expect.any(Response),
            }),
        });
    });

    it('uses custom paramsSerializer', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const request = input as Request;
            expect(request.url).toBe('https://api.example.com/items?tags=a|b|c');

            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
            paramsSerializer: (params) => `tags=${(params.tags as string[]).join('|')}`,
        });

        await baseQuery({
            url: '/items',
            params: { tags: ['a', 'b', 'c'] },
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not json-stringify FormData body', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const request = input as Request;

            expect(request.headers.get('content-type')).not.toBe('application/json');

            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
        });

        const formData = new FormData();
        formData.set('title', 'Hello');

        await baseQuery({
            url: '/upload',
            method: 'POST',
            body: formData,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns fetch error when externally aborted', async () => {
        const controller = new AbortController();

        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const request = input as Request;
            const signal = init?.signal ?? request.signal;

            return new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            });
        });

        const baseQuery = fetchBaseQuery({
            baseUrl: 'https://api.example.com',
            fetchFn: fetchMock as typeof fetch,
        });

        const promise = baseQuery({
            url: '/abort',
            signal: controller.signal,
        });

        controller.abort();

        await expect(promise).resolves.toEqual({
            error: {
                status: 'FETCH_ERROR',
                error: 'AbortError: Aborted',
            },
        });
    });
});
