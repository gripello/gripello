import { h } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'

export type SortOrder = 'asc' | 'desc' | null | undefined

export function sortIcon(order: SortOrder) {
    if (order === 'asc') return 'i-lucide-arrow-up'
    if (order === 'desc') return 'i-lucide-arrow-down'
    return 'i-lucide-arrow-up-down'
}

export function sortHeader(
    label: string,
    order: SortOrder,
    onClick: () => void,
    testId?: string,
) {
    return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label,
        trailingIcon: sortIcon(order),
        class: '-mx-2.5 w-[calc(100%+1.25rem)] font-semibold',
        'data-testid': testId,
        onClick,
    })
}
