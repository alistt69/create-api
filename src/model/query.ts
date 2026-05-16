import { type QueryBuilderDefinition, type QueryDefinitionInput } from './types.js';

type QuerySignature<R, A, Raw = R> = Omit<QueryDefinitionInput<R, A, Raw>, 'type'>;

export function query<R, A, Raw = R>(signature: QuerySignature<R, A, Raw>): QueryBuilderDefinition<R, A, Raw> {
    return {
        type: 'query',
        ...signature,
    };
}
