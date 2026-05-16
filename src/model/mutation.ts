import { type MutationBuilderDefinition, type MutationDefinitionInput } from './types.js';

type MutationSignature<R, A, Raw = R> = Omit<MutationDefinitionInput<R, A, Raw>, 'type'>;

export function mutation<R, A, Raw = R>(signature: MutationSignature<R, A, Raw>): MutationBuilderDefinition<R, A, Raw> {
    return {
        ...signature,
        type: 'mutation',
    };
}
