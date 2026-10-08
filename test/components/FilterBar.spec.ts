import { mount } from '@vue/test-utils'
import FilterBar from '~/components/FilterBar.vue'

const sheetStub = {
    props: ['modelValue', 'title'],
    emits: ['update:modelValue'],
    template:
        '<div data-testid="filter-sheet" :data-open="modelValue"><slot /><slot name="actions" /></div>',
}
const buttonStub = {
    emits: ['click'],
    template:
        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
}

function createWrapper(
    activeFilterCount: number,
    props: { searchLabel?: string; searchPlaceholder?: string } = {},
) {
    return mount(FilterBar, {
        props: { activeFilterCount, ...props },
        slots: { filters: '<span class="filter" />' },
        global: {
            stubs: {
                LayoutDialogShell: sheetStub,
                UButton: buttonStub,
                UInput: true,
                UBadge: true,
            },
            mocks: { $t: (key: string) => key },
        },
    })
}

describe('FilterBar sheet', () => {
    beforeEach(() => {
        vi.stubGlobal('useDisplay', () => ({ smAndUp: ref(false) }))
    })

    it('renders the filters in the sheet on phones', () => {
        const wrapper = createWrapper(0)

        expect(
            wrapper.find('[data-testid="filter-sheet"] .filter').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="filter-sheet-clear"]').exists(),
        ).toBe(false)
    })

    it('clears from the sheet footer when filters are active', async () => {
        const wrapper = createWrapper(2)

        await wrapper.get('[data-testid="filter-sheet-clear"]').trigger('click')

        expect(wrapper.emitted('clear')).toHaveLength(1)
        expect(
            wrapper.get('[data-testid="filter-sheet"]').attributes('data-open'),
        ).toBe('false')
    })
})

describe('FilterBar search placeholder', () => {
    const props = {
        searchLabel: 'Search routes',
        searchPlaceholder: 'Long hint',
    }

    it('uses the short label on phones', () => {
        vi.stubGlobal('useDisplay', () => ({ smAndUp: ref(false) }))
        const wrapper = createWrapper(0, props)

        expect(
            wrapper
                .get('[data-testid="filter-search"]')
                .attributes('placeholder'),
        ).toBe('Search routes')
    })

    it('uses the hint on wider screens', () => {
        vi.stubGlobal('useDisplay', () => ({ smAndUp: ref(true) }))
        const wrapper = createWrapper(0, props)

        expect(
            wrapper
                .get('[data-testid="filter-search"]')
                .attributes('placeholder'),
        ).toBe('Long hint')
    })
})
