import {
    type BaseQueryFn,
    type FetchBaseQueryArgs,
    type FetchBaseQueryError,
    type FetchBaseQueryMeta,
    type FetchBaseQueryOptions,
} from '../model/types.js';

function joinUrls(baseUrl: string | undefined, url: string): string {
    if (!baseUrl) {
        return url;
    }

    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const normalizedUrl = url.startsWith('/') ? url : `/${url}`;

    return `${normalizedBase}${normalizedUrl}`;
}

function appendParams(
    url: string,
    params: Record<string, unknown> | undefined,
    paramsSerializer?: (params: Record<string, unknown>) => string,
): string {
    if (!params) {
        return url;
    }

    const queryString = paramsSerializer
        ? paramsSerializer(params)
        : new URLSearchParams(
            Object.entries(params)
                .filter(([, value]) => value !== undefined && value !== null)
                .map(([key, value]) => [key, String(value)]),
        ).toString();

    if (!queryString) {
        return url;
    }

    const separator = url.includes('?') ? '&' : '?';

    return `${url}${separator}${queryString}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && !(value instanceof FormData)
      && !(value instanceof Blob)
      && !(value instanceof URLSearchParams);
}

async function parseResponse(
    response: Response,
    responseHandler: FetchBaseQueryArgs['responseHandler'] | FetchBaseQueryOptions['responseHandler'],
): Promise<unknown> {
    if (response.status === 204) {
        return null;
    }

    if (typeof responseHandler === 'function') {
        return responseHandler(response);
    }

    if (responseHandler === 'text') {
        return response.text();
    }

    if (responseHandler === 'content-type') {
        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('application/json')) {
            const text = await response.text();

            return text ? JSON.parse(text) : null;
        }

        return response.text();
    }

    const text = await response.text();

    return text ? JSON.parse(text) : null;
}

function defaultValidateStatus(response: Response): boolean {
    return response.status >= 200 && response.status <= 299;
}

export function fetchBaseQuery(
    options: FetchBaseQueryOptions = {},
): BaseQueryFn<unknown, FetchBaseQueryError, FetchBaseQueryMeta, FetchBaseQueryArgs> {
    return async function baseQuery(args: FetchBaseQueryArgs) {
        const mergedUrl = joinUrls(options.baseUrl, args.url);
        const finalUrl = appendParams(mergedUrl, args.params, options.paramsSerializer);

        const method = args.method ?? 'GET';
        const headers = new Headers(args.headers);

        const preparedHeaders = options.prepareHeaders?.(headers, { arg: args });
        const finalHeaders = preparedHeaders ?? headers;

        let body: BodyInit | undefined;

        if (args.body !== undefined) {
            if (isPlainObject(args.body)) {
                if (!finalHeaders.has('content-type')) {
                    finalHeaders.set('content-type', 'application/json');
                }

                body = JSON.stringify(args.body);
            }
            else {
                body = args.body as BodyInit;
            }
        }

        const requestInit: RequestInit = {
            body,
            method,
            headers: finalHeaders,
        };

        const timeout = args.timeout ?? options.timeout;

        const controller = new AbortController();
        const externalSignal = args.signal;

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let didTimeout = false;

        if (timeout !== undefined) {
            timeoutId = setTimeout(() => {
                didTimeout = true;
                controller.abort();
            }, timeout);
        }

        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            }
            else {
                externalSignal.addEventListener('abort', () => {
                    controller.abort();
                }, { once: true });
            }
        }

        requestInit.signal = controller.signal;

        const fetchFn = options.fetchFn ?? fetch;

        const requestForMeta = new Request(finalUrl, {
            method: requestInit.method,
            headers: requestInit.headers,
        });

        try {
            const response = await fetchFn(finalUrl, requestInit);

            const meta: FetchBaseQueryMeta = {
                request: requestForMeta,
                response,
            };

            const responseHandler = args.responseHandler ?? options.responseHandler ?? 'json';

            let data: unknown;
            const responseClone = response.clone();

            try {
                data = await parseResponse(response, responseHandler);
            }
            catch (error) {
                return {
                    error: {
                        status: 'PARSING_ERROR',
                        originalStatus: response.status,
                        data: await responseClone.text(),
                        error: error instanceof Error ? error.message : String(error),
                    },
                    meta,
                };
            }

            const validateStatus = args.validateStatus ?? options.validateStatus ?? defaultValidateStatus;

            if (!validateStatus(response, data)) {
                return {
                    error: {
                        status: response.status,
                        data,
                    },
                    meta,
                };
            }

            return { data, meta };
        }
        catch (error) {
            if (didTimeout) {
                return {
                    error: {
                        status: 'TIMEOUT_ERROR',
                        error: 'Request timed out',
                    },
                };
            }

            return {
                error: {
                    status: 'FETCH_ERROR',
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
        finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    };
}
