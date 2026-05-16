let nextRequestId = 0;

export function createRequestId(): string {
    nextRequestId += 1;

    return `request-${nextRequestId}`;
}
