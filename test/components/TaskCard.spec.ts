import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import TaskCard from '~/components/task/Card.vue'
import type { TaskRecord } from '~/types/models'

const token = ref('')
const renew = vi.fn()

const task = {
    id: 'task1',
    kind: 'defect',
    priority: 2,
    status: 'open',
    photo: 'photo_abc.jpg',
    created: '2026-10-01T10:00:00.000Z',
} as TaskRecord

function mountCard() {
    return mount(TaskCard, {
        props: { task },
        global: {
            stubs: {
                LayoutImageViewer: {
                    props: ['src'],
                    template: '<div :data-src="src"><slot /></div>',
                },
                RouteSummary: true,
                ClimberAvatar: true,
                UBadge: true,
                UButton: true,
                UDropdownMenu: true,
                UIcon: true,
                UTooltip: true,
            },
        },
    })
}

describe('TaskCard photo', () => {
    beforeEach(() => {
        token.value = ''
        renew.mockReset()
        vi.stubGlobal('useGymPath', () => (path: string) => `/gym${path}`)
        vi.stubGlobal('useFileToken', () => ({ token, renew }))
    })

    it('renders no protected image before the file token exists', async () => {
        const wrapper = mountCard()
        expect(wrapper.find('[data-testid="task-card-photo"]').exists()).toBe(
            false,
        )

        token.value = 'tok'
        await flushPromises()
        const photo = wrapper.get('[data-testid="task-card-photo"]')
        expect(photo.attributes('src')).toContain('token=tok')
    })

    it('renews the token when the photo fails to load', async () => {
        token.value = 'tok'
        const wrapper = mountCard()
        await wrapper.get('[data-testid="task-card-photo"]').trigger('error')
        expect(renew).toHaveBeenCalled()
    })
})

describe('TaskCard actions', () => {
    beforeEach(() => {
        vi.stubGlobal('useGymPath', () => (path: string) => `/gym${path}`)
        vi.stubGlobal('useFileToken', () => ({ token: ref(''), renew }))
    })

    it('keeps edit and open route in the menu, not as buttons', () => {
        const wrapper = mount(TaskCard, {
            props: {
                task: {
                    ...task,
                    photo: '',
                    route: 'r1',
                    expand: { route: { id: 'r1', name: 'Arete' } },
                } as unknown as TaskRecord,
            },
            global: {
                stubs: {
                    UDropdownMenu: {
                        props: ['items'],
                        template:
                            '<div data-testid="menu" :data-items="JSON.stringify(items.flat().map((i) => i[\'data-testid\'] ?? null))"><slot /></div>',
                    },
                    RouteSummary: true,
                    ClimberAvatar: true,
                    UBadge: true,
                    UButton: true,
                    UIcon: true,
                    UTooltip: true,
                    LayoutImageViewer: true,
                },
            },
        })
        const items = JSON.parse(
            wrapper.get('[data-testid="menu"]').attributes('data-items')!,
        )
        expect(items).toContain('task-card-edit')
        expect(items).toContain('task-card-route')
        expect(wrapper.find('[data-testid="task-card-edit"]').exists()).toBe(
            false,
        )
    })
})
