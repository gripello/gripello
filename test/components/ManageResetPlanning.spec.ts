import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref, watch } from 'vue'
import RouteReset from '~/components/manage/RouteReset.vue'
import WallReset from '~/components/manage/WallReset.vue'
import { archiveRoutes, planRouteRemoval } from '~/api/routes'

vi.mock('~/api/routes', () => ({
    archiveRoutes: vi.fn(),
    planRouteRemoval: vi.fn(),
}))

const now = new Date(2026, 5, 10, 12)
const route = {
    id: 'route1',
    name: 'Crimp',
    permanent: false,
    removal_planned_for: null,
    screw_date: '2026-01-01',
}

const inputStub = {
    props: ['modelValue'],
    template: '<input v-bind="$attrs" :value="modelValue" />',
}
const buttonStub = {
    props: ['disabled'],
    emits: ['click'],
    template:
        '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}
const confirmStub = {
    props: ['modelValue'],
    emits: ['confirm'],
    template:
        '<div v-if="modelValue" data-testid="done-dialog"><button data-testid="done-confirm" @click="$emit(\'confirm\')" /></div>',
}
const stubs = {
    UInput: inputStub,
    UButton: buttonStub,
    ConfirmDialog: confirmStub,
    ManageRouteFlags: true,
    UBadge: true,
    UCheckbox: true,
    UIcon: true,
    LayoutEyebrow: true,
    RouteColorDot: true,
    GradeLabel: true,
}

beforeEach(() => {
    vi.mocked(planRouteRemoval).mockReset()
    vi.mocked(archiveRoutes).mockReset()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useI18n', () => ({
        t: (key: string) => key,
        locale: ref('en'),
    }))
    vi.stubGlobal('useGymPath', () => (path: string) => path)
    vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
    vi.stubGlobal('useAsyncAction', () => ({
        pending: ref(false),
        run: async (action: () => Promise<unknown>) => {
            try {
                return await action()
            } catch {
                return undefined
            }
        },
    }))
})

describe('RouteReset', () => {
    it('offers no planned removal date before today', async () => {
        const wrapper = mount(RouteReset, {
            props: { route, flags: [], now },
            global: { stubs },
        })
        const date = wrapper.get('[data-testid="route-reset-date"]')
        expect(date.attributes('min')).toBe('2026-06-10')

        await wrapper
            .getComponent<typeof inputStub>('[data-testid="route-reset-date"]')
            .vm.$emit('update:modelValue', '2026-06-09')
        expect(
            wrapper
                .get('[data-testid="route-reset-plan"]')
                .attributes('disabled'),
        ).toBeDefined()
    })
})

describe('WallReset', () => {
    const planned = { ...route, removal_planned_for: '2026-06-20' }
    const row = {
        wall: { id: 'w1', name: 'North' },
        routes: [planned, { ...route, id: 'route2' }],
        planned: [planned],
        flagged: [],
        flags: new Map(),
        plannedFor: '2026-06-20',
        averageAgeDays: null,
        heat: 0,
    }
    const mountWall = () =>
        mount(WallReset, {
            props: { row, stats: new Map(), urgency: new Map(), now },
            global: { stubs },
        } as never)

    it('keeps the done dialog open when archiving fails', async () => {
        vi.mocked(archiveRoutes).mockRejectedValueOnce(new Error('down'))
        const wrapper = mountWall()
        await wrapper.get('[data-testid="reset-done"]').trigger('click')
        await wrapper.get('[data-testid="done-confirm"]').trigger('click')
        await flushPromises()

        expect(wrapper.find('[data-testid="done-dialog"]').exists()).toBe(true)
        expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('refreshes the wall when unplanning fails after the plan was saved', async () => {
        vi.mocked(planRouteRemoval)
            .mockResolvedValueOnce(undefined as never)
            .mockRejectedValueOnce(new Error('down'))
        const wrapper = mountWall()
        expect(
            wrapper.get('[data-testid="reset-date"]').attributes('min'),
        ).toBe('2026-06-10')
        await wrapper.get('[data-testid="reset-select-none"]').trigger('click')
        await wrapper
            .get('[data-testid="reset-route-route2"]')
            .findComponent({ name: 'UCheckbox' })
            .vm.$emit('update:modelValue', true)
        await wrapper.get('[data-testid="reset-save"]').trigger('click')
        await flushPromises()

        expect(planRouteRemoval).toHaveBeenNthCalledWith(
            2,
            'gym1',
            ['route1'],
            null,
        )
        expect(wrapper.emitted('changed')).toHaveLength(1)
    })
})
