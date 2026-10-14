import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import BetaVideos from '~/components/route/BetaVideos.vue'

vi.mock('~/api/ratings', () => ({
    listBetas: vi.fn(async () => []),
    createBeta: vi.fn(),
    deleteBeta: vi.fn(),
}))

beforeEach(() => {
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('useAuthStore', () => ({ isValid: true }))
    vi.stubGlobal('useRoute', () => ({ fullPath: '/route?id=r1' }))
    vi.stubGlobal('useAsyncAction', () => ({
        pending: ref(false),
        run: vi.fn(),
    }))
    vi.stubGlobal('useBlocks', () => ({ isBlocked: () => false }))
    vi.stubGlobal('useNotification', () => ({ success: vi.fn() }))
    vi.stubGlobal('navigateTo', vi.fn())
})

async function openDialog(links: boolean, uploads: boolean) {
    const wrapper = mount(BetaVideos, {
        props: { routeId: 'r1', links, uploads },
        global: {
            stubs: {
                LayoutDialogShell: {
                    template: '<div><slot /><slot name="actions" /></div>',
                },
                SegmentedControl: {
                    template: '<div data-testid="beta-source" />',
                },
                UFormField: { template: '<div><slot /></div>' },
                UInput: { template: '<input data-testid="beta-link" />' },
                LayoutScrollStrip: true,
                RouteBetaTile: true,
                RouteBetaPlayer: true,
                ReportsFormDialog: true,
                ConfirmDialog: true,
                UButton: true,
                UBadge: true,
                UIcon: true,
            },
        },
    })
    ;(wrapper.vm as unknown as { openAdd: () => void }).openAdd()
    await nextTick()
    return wrapper
}

describe('RouteBetaVideos', () => {
    it('offers only links when uploads are off', async () => {
        const wrapper = await openDialog(true, false)
        expect(wrapper.find('[data-testid="beta-link"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="beta-file"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="beta-source"]').exists()).toBe(false)
    })

    it('offers only uploads when links are off', async () => {
        const wrapper = await openDialog(false, true)
        expect(wrapper.find('[data-testid="beta-file"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="beta-link"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="beta-source"]').exists()).toBe(false)
    })

    it('lets the climber pick when both are on', async () => {
        const wrapper = await openDialog(true, true)
        expect(wrapper.find('[data-testid="beta-source"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="beta-link"]').exists()).toBe(true)
    })
})
