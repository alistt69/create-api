<table width="100%">
  <tr>
    <td width="190" align="center">
      <img src="assets/alistt69-packages-logo.svg" alt="@alistt69 packages logo" width="160" height="160" />
    </td>
    <td>
      <h1>@alistt69/create-api</h1>

> **One helper. No extra.**  
> A lightweight createApi inspired by **RTKQ** — with query, lazy query and mutation hooks & endpoint controllers, built-in cache utilities, stale data handling and a tiny, focused API.

[![npm version](https://img.shields.io/npm/v/@alistt69/create-api.svg)](https://www.npmjs.com/package/@alistt69/create-api)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![npm downloads](https://img.shields.io/npm/dm/@alistt69/create-api.svg)](https://www.npmjs.com/package/@alistt69/create-api)
[![React Version](https://img.shields.io/badge/react-%3E%3D16.8-149eca?logo=react&logoColor=white)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/alistt69/create-api/actions/workflows/ci.yml/badge.svg)](https://github.com/alistt69/create-api/actions/workflows/ci.yml)
</td>
  </tr>
</table>

---

<p align="center">
  <a href="#install">Install</a>
  &middot; <a href="#quick-start">Quick Start</a>
  &middot; <a href="#the-shape">The Shape</a>
  &middot; <a href="#cache">Cache</a>
  &middot; <a href="#imperative-api">Imperative API</a>
  &middot; <a href="#controller">Controller</a>
</p>

---

## Why this exists

`@alistt69/create-api` is for React projects that like the ergonomics of
RTK Query, but do not want to introduce Redux just to fetch data.

It gives you a compact `createApi` workflow:

```txt
define endpoints -> get typed hooks -> read/write cache -> refetch when stale
```

Use it when you want:

| You need | You get |
| --- | --- |
| Generated React hooks | `useGetPostQuery`, `useLazyGetPostQuery`, `useUpdatePostMutation` |
| A small HTTP layer | `fetchBaseQuery`, built on native `fetch` |
| Cache reads and patches | `getQueryData`, `setQueryData`, `updateQueryData` |
| Stale data handling | `staleTime`, `keepUnusedDataFor`, `refetchOnMount` |
| Manual orchestration | `api.endpoints.*.initiate`, `select`, `subscribe` |
| Store-based usage | `createController` from the controller subpath |

## Install

```bash
npm i @alistt69/create-api
```

Requirements:

| Runtime | Version |
| --- | --- |
| Node.js | `>=18` |
| React | `>=16.8` |

## Quick Start

Create an API once:

```tsx
import { createApi, fetchBaseQuery } from '@alistt69/create-api';

const api = createApi({
  baseQuery: fetchBaseQuery({
    baseUrl: 'https://example.com/api',
  }),

  endpoints: (builder) => ({
    getPost: builder.query({
      query: (id: string) => ({
        url: `/posts/${id}`,
      }),
    }),

    updatePost: builder.mutation({
      query: ({ id, title }: { id: string; title: string }) => ({
        url: `/posts/${id}`,
        method: 'PATCH',
        body: { title },
      }),
    }),
  }),
});
```

Then use the generated hooks:

```tsx
function Post() {
  const { data, isLoading, refetch } = api.useGetPostQuery('1');
  const [updatePost, updateState] = api.useUpdatePostMutation();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <section>
      <h2>{data?.title}</h2>

      <button
        disabled={updateState.isLoading}
        onClick={() => updatePost({ id: '1', title: 'Updated' })}
      >
        Update
      </button>

      <button onClick={() => refetch()}>
        Refetch
      </button>
    </section>
  );
}
```

## The Shape

The package is intentionally small, but the surface area covers the core
data-fetching loop.

### Query hooks

```tsx
const result = api.useGetPostQuery('1', {
  enabled: true,
  refetchOnMount: true,
});
```

Query state includes:

| Field | Meaning |
| --- | --- |
| `data` | Last successful value |
| `error` | Last failed value |
| `status` | `uninitialized`, `pending`, `fulfilled` or `rejected` |
| `isLoading` | First request is in progress |
| `isFetching` | Any request is in progress, including background refetch |
| `isSuccess` | Last known state is successful |
| `isError` | Last known state is failed |
| `fulfilledAt` | Timestamp of the last fulfilled request |
| `requestId` | Active or last request id |

### Lazy query hooks

```tsx
const [loadPost, post] = api.useLazyGetPostQuery();

await loadPost('1');

post.refetch();
```

Lazy queries are useful when the request should start from a user action,
a modal opening, a route transition or another explicit event.

### Mutation hooks

```tsx
const [updatePost, updateState] = api.useUpdatePostMutation();

await updatePost({ id: '1', title: 'Updated' });

updateState.reset();
```

Mutation state tracks the latest trigger. This keeps UI behavior predictable
when several mutation calls overlap.

## `fetchBaseQuery`

`fetchBaseQuery` is a ready-to-use `baseQuery` built on top of native `fetch`.
It handles URLs, params, JSON bodies, headers, timeouts and response parsing.

```tsx
import { createApi, fetchBaseQuery } from '@alistt69/create-api';

const api = createApi({
  baseQuery: fetchBaseQuery({
    baseUrl: 'https://example.com/api',
    timeout: 10_000,
    credentials: 'include',
    prepareHeaders: (headers) => {
      headers.set('authorization', 'Bearer token');
      return headers;
    },
  }),

  endpoints: (builder) => ({
    getTickets: builder.query({
      query: ({ page }: { page: number }) => ({
        url: '/tickets',
        params: { page },
      }),
    }),
  }),
});
```

Supported options:

| Option | Where | Purpose |
| --- | --- | --- |
| `baseUrl` | base query | Prefix all request URLs |
| `headers` | request | Add request-specific headers |
| `prepareHeaders` | base query | Modify headers before every request |
| `params` | request | Append query params |
| `paramsSerializer` | base query | Customize query string serialization |
| `body` | request | Send JSON, `FormData`, `Blob`, `URLSearchParams` or another fetch body |
| `credentials` | both | Control cookie/auth credential handling (`omit`, `same-origin`, `include`) |
| `timeout` | both | Abort slow requests |
| `responseHandler` | both | Parse as `json`, `text`, `content-type` or custom handler |
| `validateStatus` | both | Decide whether a response is success |
| `fetchFn` | base query | Use a custom fetch implementation |

Custom response handling:

```tsx
downloadReport: builder.query({
  query: () => ({
    url: '/report',
    responseHandler: (response) => response.blob(),
  }),
});
```

## Cache

Queries are cached by endpoint name and serialized argument.

```tsx
const api = createApi({
  baseQuery,
  endpoints: (builder) => ({
    getTicketById: builder.query({
      query: (id: string) => ({ url: `/tickets/${id}` }),
      serializeArgs: (id) => id,
      staleTime: 2_000,
      keepUnusedDataFor: 10_000,
    }),
  }),
});
```

Cache controls:

| Option | Behavior |
| --- | --- |
| `serializeArgs` | Builds the cache key for an endpoint argument |
| `staleTime` | Keeps fulfilled data fresh for automatic mount behavior |
| `keepUnusedDataFor` | Keeps unused cache alive after the last subscriber leaves |
| `refetchOnMount` | Controls whether cached data may refetch on mount |
| `enabled` | Disables automatic query execution while keeping manual `refetch` available |

Manual cache updates:

```tsx
api.util.getQueryData('getPost', '1');

api.util.setQueryData('getPost', '1', {
  id: '1',
  title: 'Local title',
});

api.util.updateQueryData('getPost', '1', (prev) => ({
  ...prev,
  title: 'Patched title',
}));
```

### Invalidation

Use endpoint-level invalidation for broad refetching:

```tsx
editTicket: builder.mutation({
  query: ({ id, title }) => ({
    url: `/tickets/${id}`,
    method: 'PATCH',
    body: { title },
  }),
  invalidates: ['getTickets'],
});
```

Use tag invalidation when you want to target specific cached records:

```tsx
getTicketById: builder.query({
  query: (id) => ({ url: `/tickets/${id}` }),
  providesTags: (_result, id) => [`Ticket/${id}`],
}),

editTicket: builder.mutation({
  query: ({ id, title }) => ({
    url: `/tickets/${id}`,
    method: 'PATCH',
    body: { title },
  }),
  invalidatesTags: (_result, arg) => [`Ticket/${arg.id}`],
});
```

## Imperative API

Every endpoint also exposes a small imperative API. It is useful when a query
lifecycle should live outside React components.

```tsx
const request = api.endpoints.getPost.initiate('1');

const data = await request.unwrap();

await request.refetch();

request.unsubscribe();
request.abort();
```

You can also inspect query state directly:

```tsx
const state = api.endpoints.getPost.select('1');
```

And trigger mutations:

```tsx
const mutation = api.endpoints.updatePost.initiate({
  id: '1',
  title: 'Updated',
});

await mutation.unwrap();

mutation.abort();
```

## Controller

For store-based usage, import `createController` from the controller subpath:

```tsx
import { createController } from '@alistt69/create-api/controller';

class TicketStore {
    private ticket = createController(api.endpoints.getTicketById);
    private editTicket = createController(api.endpoints.editTicket);

    ticketState = this.ticket.state;
    editTicketState = this.editTicket.state;

    private unsubscribers = [
        this.ticket.subscribe(() => {
            this.ticketState = this.ticket.state;
        }),
        this.editTicket.subscribe(() => {
            this.editTicketState = this.editTicket.state;
        }),
    ];

    load(id: string) {
        return this.ticket.run(id);
    }

    save(id: string, title: string) {
        return this.editTicket.run({ id, title });
    }

    get ticketData() {
        return this.ticketState.data;
    }

    get isLoadingTicket() {
        return this.ticketState.isLoading;
    }

    get isSavingTicket() {
        return this.editTicketState.isLoading;
    }

    destroy() {
        this.unsubscribers.forEach((unsubscribe) => unsubscribe());
        this.ticket.dispose();
        this.editTicket.dispose();
    }
}
```

The controller keeps endpoint state outside React, subscribes to cache updates,
and releases its subscription with `dispose()`.

## Demo

[Live demo](https://create-api-demo.vercel.app/)

Sandbox is coming soon.

## License

MIT. See [LICENSE](./LICENSE).
