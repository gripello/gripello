import { sortHeader, sortIcon } from '~/utils/tableSortHeader'

vi.mock('@nuxt/ui/components/Button.vue', () => ({
    default: { name: 'UButton' },
}))

describe('sortHeader', () => {
    it('shows the sort direction and calls back on click', () => {
        expect(sortIcon('asc')).toBe('i-lucide-arrow-up')
        expect(sortIcon('desc')).toBe('i-lucide-arrow-down')
        expect(sortIcon(null)).toBe('i-lucide-arrow-up-down')

        const onClick = vi.fn()
        const node = sortHeader('Status', 'desc', onClick, 'sort-status')
        expect(node.props).toMatchObject({
            label: 'Status',
            trailingIcon: 'i-lucide-arrow-down',
            'data-testid': 'sort-status',
        })
        node.props!.onClick()
        expect(onClick).toHaveBeenCalledOnce()
    })
})
