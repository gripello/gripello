import type { ApiRecord } from '~/composables/authStore'

export type UserEventAction =
    { kind: 'clear' } | { kind: 'save'; record: ApiRecord } | { kind: 'ignore' }

export function userEventAction(event: {
    kind: string
    record?: ApiRecord
}): UserEventAction {
    if (event.kind === 'user.deleted') return { kind: 'clear' }
    if (event.kind === 'user.updated' && event.record)
        return { kind: 'save', record: event.record }
    return { kind: 'ignore' }
}
