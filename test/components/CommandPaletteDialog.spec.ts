import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, useTemplateRef } from 'vue'
import CommandPaletteDialog from '~/components/layout/CommandPaletteDialog.vue'
import type { SearchGroup } from '~/composables/useGlobalSearch'

const search = vi.fn<(query: string) => Promise<SearchGroup[]>>()
let gymName: string | null = 'Boulderhaus'

const UModal = defineComponent({
    emits: ['after:enter'],
    setup(_, { slots }) {
        return () => h('div', slots.content?.())
    },
})
const UCommandPalette = defineComponent({
    props: ['groups', 'placeholder', 'searchTerm', 'loading', 'input', 'ui'],
    emits: ['update:searchTerm'],
    setup(props, { slots }) {
        return () =>
            h('div', [
                h('input', {
                    'data-testid': 'command-palette-input',
                    value: props.searchTerm,
                }),
                props.groups.length ? null : slots.empty?.(),
            ])
    },
})

vi.stubGlobal('useTemplateRef', useTemplateRef)

beforeEach(() => {
    vi.useFakeTimers()
    search.mockReset()
    gymName = 'Boulderhaus'
    vi.stubGlobal('useGlobalSearch', () => ({ search }))
    vi.stubGlobal('useGym', () => ({
        gym: { value: gymName ? { name: gymName } : null },
    }))
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useI18n', () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}:${JSON.stringify(params)}` : key,
    }))
})

afterEach(() => vi.useRealTimers())

const mountDialog = () =>
    mount(CommandPaletteDialog, {
        attachTo: document.body,
        props: { open: true, pages: [] },
        global: {
            stubs: { UModal, UCommandPalette, UKbd: true, UIcon: true },
            mocks: { $t: (key: string) => key },
        },
    })

const palette = (wrapper: ReturnType<typeof mountDialog>) =>
    wrapper.findComponent(UCommandPalette)

const typeQuery = async (
    wrapper: ReturnType<typeof mountDialog>,
    value: string,
) => {
    palette(wrapper).vm.$emit('update:searchTerm', value)
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
}

enableAutoUnmount(afterEach)

describe('LayoutCommandPaletteDialog', () => {
    it('names the gym it searches', () => {
        expect(palette(mountDialog()).props('placeholder')).toBe(
            'nav.commandPalettePlaceholder:{"gym":"Boulderhaus"}',
        )
        gymName = null
        expect(palette(mountDialog()).props('placeholder')).toBe(
            'nav.commandPalettePlaceholder:{"gym":"Gripello"}',
        )
    })

    it('shows a failed search with a retry instead of no results', async () => {
        search.mockResolvedValue([
            {
                key: 'routes',
                label: 'nav.paletteGroupRoutes',
                items: [],
                error: { status: 0 },
            },
        ])
        const wrapper = mountDialog()
        await typeQuery(wrapper, 'crimp')

        const [group] = palette(wrapper).props('groups')
        expect(group).toMatchObject({
            id: 'error',
            label: 'errors.offline.title',
            items: [{ label: 'errors.retry' }],
        })
        expect(wrapper.text()).not.toContain('nav.commandPaletteEmpty')

        search.mockResolvedValue([
            { key: 'routes', label: 'nav.paletteGroupRoutes', items: [] },
        ])
        group.items[0].onSelect()
        await vi.advanceTimersByTimeAsync(200)
        await flushPromises()
        expect(search).toHaveBeenCalledTimes(2)
        expect(palette(wrapper).props('groups')).toEqual([])
        expect(wrapper.text()).toContain('nav.commandPaletteEmpty')
    })

    it('keeps results of sources that answered next to the failure', async () => {
        search.mockResolvedValue([
            {
                key: 'routes',
                label: 'nav.paletteGroupRoutes',
                items: [{ key: 'r1', to: '/r1', icon: 'x', title: 'Crimp' }],
            },
            {
                key: 'users',
                label: 'routes.users',
                items: [],
                error: { status: 500 },
            },
        ])
        const wrapper = mountDialog()
        await typeQuery(wrapper, 'crimp')
        expect(
            palette(wrapper)
                .props('groups')
                .map((group: { id: string }) => group.id),
        ).toEqual(['error', 'routes'])
        expect(palette(wrapper).props('groups')[0].label).toBe(
            'errors.loadFailed',
        )
    })

    it('keeps the query when reopened and selects it', async () => {
        search.mockResolvedValue([])
        const wrapper = mountDialog()
        await typeQuery(wrapper, 'crimp')
        await wrapper.setProps({ open: false })
        await wrapper.setProps({ open: true })
        expect(palette(wrapper).props('searchTerm')).toBe('crimp')

        const input = wrapper.get('input').element as HTMLInputElement
        const select = vi.spyOn(input, 'select')
        wrapper.findComponent(UModal).vm.$emit('after:enter')
        expect(select).toHaveBeenCalled()
    })
})
