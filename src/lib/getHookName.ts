import { type EndpointType, type HookName } from '../model/types.js';
import { typedCapitalize } from './typedCapitalize.js';

export function getHookName<K extends string, T extends EndpointType, L extends string = ''>(key: K, type: T, lazy: L): HookName<K, T, L> {
    return `use${lazy}${typedCapitalize(key)}${typedCapitalize(type)}`;
}
