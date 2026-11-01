import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import BetaVideos from '~/components/route/BetaVideos.vue'
import { createBeta, deleteBeta, listBetas } from '~/api/ratings'
import { dialogShellStub } from '../__stubs__/dialogShell'

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

    it('keeps the delete confirmation open when deleting fails', async () => {
        vi.mocked(listBetas).mockResolvedValue([
            { id: 'b1', user: 'u1', route: 'r1' },
        ] as never)
        vi.mocked(deleteBeta).mockRejectedValueOnce(new Error('down'))
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: async (action: () => Promise<unknown>) =>
                action().catch(() => undefined),
        }))
        const wrapper = mount(BetaVideos, {
            props: { routeId: 'r1', links: true, uploads: false },
            global: {
                stubs: {
                    LayoutScrollStrip: { template: '<div><slot /></div>' },
                    RouteBetaTile: {
                        emits: ['delete'],
                        template:
                            '<button data-testid="tile-delete" @click="$emit(\'delete\')" />',
                    },
                    ConfirmDialog: {
                        props: ['modelValue'],
                        emits: ['confirm'],
                        template:
                            '<button v-if="modelValue" data-testid="delete-confirm" @click="$emit(\'confirm\')" />',
                    },
                    LayoutDialogShell: true,
                    RouteBetaPlayer: true,
                    ReportsFormDialog: true,
                    UButton: true,
                    UBadge: true,
                    UIcon: true,
                },
            },
        })
        await flushPromises()
        await wrapper.get('[data-testid="tile-delete"]').trigger('click')
        await wrapper.get('[data-testid="delete-confirm"]').trigger('click')
        await flushPromises()

        expect(deleteBeta).toHaveBeenCalledWith('b1')
        expect(wrapper.find('[data-testid="delete-confirm"]').exists()).toBe(
            true,
        )
    })
})

describe('RouteBetaVideos list and submit', () => {
    beforeEach(() => {
        vi.mocked(listBetas).mockReset().mockResolvedValue([])
        vi.mocked(createBeta).mockReset()
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: async (action: () => Promise<unknown>) =>
                action().catch(() => undefined),
        }))
    })

    function mountList(notify = vi.fn()) {
        vi.stubGlobal('useNotification', () => ({ success: notify }))
        return mount(BetaVideos, {
            props: { routeId: 'r1', links: true, uploads: true },
            global: {
                stubs: {
                    LayoutScrollStrip: { template: '<div><slot /></div>' },
                    RouteBetaTile: {
                        props: ['video', 'deletable'],
                        template:
                            '<p data-testid="tile" :data-id="video.id" :data-deletable="deletable" />',
                    },
                    LayoutDialogShell: dialogShellStub,
                    SegmentedControl: {
                        props: ['modelValue'],
                        emits: ['update:modelValue'],
                        template:
                            '<button data-testid="to-file" @click="$emit(\'update:modelValue\', \'file\')" />',
                    },
                    UFormField: {
                        props: ['error'],
                        template:
                            '<div><slot /><p v-if="error" data-testid="link-error">{{ error }}</p></div>',
                    },
                    UInput: {
                        props: ['modelValue'],
                        emits: ['update:modelValue'],
                        template: `<input data-testid="beta-link" :value="modelValue"
                            @input="$emit('update:modelValue', $event.target.value)" />`,
                    },
                    RouteBetaPlayer: true,
                    ReportsFormDialog: true,
                    ConfirmDialog: true,
                    UButton: true,
                    UBadge: true,
                    UIcon: true,
                },
            },
        })
    }

    const open = async (wrapper: ReturnType<typeof mountList>) => {
        ;(wrapper.vm as unknown as { openAdd: () => void }).openAdd()
        await nextTick()
    }
    const submit = (wrapper: ReturnType<typeof mountList>) =>
        wrapper.get('[data-testid="beta-submit"]')

    it('sends guests to sign in instead of opening the dialog', async () => {
        vi.stubGlobal('useAuthStore', () => ({ isValid: false }))
        const navigate = vi.fn()
        vi.stubGlobal('navigateTo', navigate)
        const wrapper = mountList()
        await open(wrapper)
        expect(navigate).toHaveBeenCalledWith({
            path: '/auth/login',
            query: { redirect: '/route?id=r1' },
        })
        expect(wrapper.findComponent(dialogShellStub).props('modelValue')).toBe(
            false,
        )
    })

    it('hides blocked authors and lets only the uploader delete', async () => {
        vi.stubGlobal('useAuthStore', () => ({
            isValid: true,
            record: { id: 'me' },
        }))
        vi.stubGlobal('useBlocks', () => ({
            isBlocked: (id?: string) => id === 'troll',
        }))
        vi.mocked(listBetas).mockResolvedValue([
            { id: 'mine', user: 'me', author: { id: 'me' } },
            { id: 'theirs', user: 'u2', author: { id: 'u2' } },
            { id: 'blocked', user: 'troll', author: { id: 'troll' } },
        ] as never)
        const wrapper = mountList()
        await flushPromises()
        const tiles = wrapper.findAll('[data-testid="tile"]')
        expect(tiles.map((tile) => tile.attributes('data-id'))).toEqual([
            'mine',
            'theirs',
        ])
        expect(tiles.map((tile) => tile.attributes('data-deletable'))).toEqual([
            'true',
            'false',
        ])
    })

    it('accepts only supported video links and sends the trimmed one', async () => {
        vi.stubGlobal('useAuthStore', () => ({ isValid: true }))
        vi.mocked(createBeta).mockResolvedValue({ id: 'b9' } as never)
        const notify = vi.fn()
        const wrapper = mountList(notify)
        await open(wrapper)
        expect(submit(wrapper).attributes('disabled')).toBeDefined()

        await wrapper
            .get('[data-testid="beta-link"]')
            .setValue('https://evil.example/x')
        expect(wrapper.get('[data-testid="link-error"]').text()).toBe(
            'beta.invalidLink',
        )
        expect(submit(wrapper).attributes('disabled')).toBeDefined()

        await wrapper
            .get('[data-testid="beta-link"]')
            .setValue('  https://www.tiktok.com/@a/video/1  ')
        expect(wrapper.find('[data-testid="link-error"]').exists()).toBe(false)
        await submit(wrapper).trigger('click')
        await flushPromises()
        expect(createBeta).toHaveBeenCalledWith('r1', {
            url: 'https://www.tiktok.com/@a/video/1',
        })
        expect(notify).toHaveBeenCalledWith('beta.added')
        expect(listBetas).toHaveBeenCalledTimes(2)
    })

    it('refuses oversized uploads and announces premoderated ones', async () => {
        vi.stubGlobal('useAuthStore', () => ({ isValid: true }))
        vi.mocked(createBeta).mockResolvedValue({ pending: true } as never)
        const notify = vi.fn()
        let wrapper = mountList(notify)
        const pick = async (size: number) => {
            await open(wrapper)
            await wrapper.get('[data-testid="to-file"]').trigger('click')
            const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
            Object.defineProperty(file, 'size', { value: size })
            const input = wrapper.get('[data-testid="beta-file"]')
            Object.defineProperty(input.element, 'files', {
                value: [file],
                configurable: true,
            })
            await input.trigger('change')
            return file
        }
        await pick(31 * 1024 * 1024)
        expect(wrapper.find('[data-testid="beta-file-error"]').exists()).toBe(
            true,
        )
        expect(submit(wrapper).attributes('disabled')).toBeDefined()

        wrapper = mountList(notify)
        const file = await pick(1024)
        expect(submit(wrapper).attributes('disabled')).toBeUndefined()
        await submit(wrapper).trigger('click')
        await flushPromises()
        expect(createBeta).toHaveBeenCalledWith('r1', { file })
        expect(notify).toHaveBeenCalledWith('beta.awaitingApproval')
    })
})
