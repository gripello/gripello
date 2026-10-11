import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import PrivacySettings from '~/components/account/PrivacySettings.vue'

const update = vi.fn()
vi.mock('~/api/account', () => ({
    updateMe: (...args: unknown[]) => update(...args),
}))
const notifyError = vi.fn()
const unblock = vi.fn()
const blocks = ref<{ id: string; blocker: string; blocked: string }[]>([])
const switchStub = {
    props: ['modelValue'],
    template:
        '<button :data-on="modelValue" @click="$emit(\'update:modelValue\', !modelValue)" />',
}

function mountSettings(user: Record<string, unknown>) {
    globalThis.__AUTH_STORE__ = {
        record: { id: 'me', ...user },
        token: 't',
        save: vi.fn(),
    }
    return mount(PrivacySettings, {
        global: {
            stubs: {
                UPageCard: { template: '<div><slot /></div>' },
                UIcon: true,
                USelect: true,
                USwitch: switchStub,
                UButton: {
                    template:
                        '<button @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

describe('PrivacySettings', () => {
    beforeEach(() => {
        update.mockReset()
        notifyError.mockReset()
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('ref', ref)
        vi.stubGlobal('useNotification', () => ({ error: notifyError }))
        vi.stubGlobal('useBlocks', () => ({ blocks: blocks, unblock }))
        vi.stubGlobal('useClimbers', () => ({
            byId: computed(() => new Map([['them', { name: 'Them' }]])),
        }))
        blocks.value = []
        unblock.mockReset()
    })

    it('lists blocked climbers and unblocks them', async () => {
        blocks.value = [{ id: 'b1', blocker: 'me', blocked: 'them' }]
        const wrapper = mountSettings({})
        expect(wrapper.get('[data-testid="privacy-blocked"]').text()).toContain(
            'Them',
        )
        await wrapper.get('[data-testid="privacy-unblock"]').trigger('click')
        expect(unblock).toHaveBeenCalledWith('them')
    })

    it('shows names on reviews and shares sends unless turned off', () => {
        const wrapper = mountSettings({ reviews_anonymous: true })
        expect(
            wrapper
                .get('[data-testid="privacy-reviewName"]')
                .attributes('data-on'),
        ).toBe('false')
        expect(
            wrapper
                .get('[data-testid="privacy-shareSends"]')
                .attributes('data-on'),
        ).toBe('true')
    })

    it('saves each toggle as its hidden field', async () => {
        update.mockResolvedValue({ id: 'me' })
        const wrapper = mountSettings({})
        await wrapper.get('[data-testid="privacy-shareSends"]').trigger('click')
        await wrapper.get('[data-testid="privacy-reviewName"]').trigger('click')
        await flushPromises()
        expect(update).toHaveBeenNthCalledWith(1, { ticks_private: true })
        expect(update).toHaveBeenNthCalledWith(2, { reviews_anonymous: true })
    })

    it('rolls a toggle back when saving fails', async () => {
        update.mockRejectedValue(new Error('offline'))
        const wrapper = mountSettings({})
        const toggle = wrapper.get('[data-testid="privacy-shareSends"]')
        await toggle.trigger('click')
        await flushPromises()
        expect(toggle.attributes('data-on')).toBe('true')
        expect(notifyError).toHaveBeenCalled()
    })

    it('keeps a later successful toggle when an earlier save fails', async () => {
        let failFirst: (error: Error) => void = () => undefined
        update
            .mockImplementationOnce(
                () => new Promise((_, reject) => (failFirst = reject)),
            )
            .mockResolvedValueOnce({ id: 'me' })
        const wrapper = mountSettings({})
        const shareSends = wrapper.get('[data-testid="privacy-shareSends"]')
        const reviewName = wrapper.get('[data-testid="privacy-reviewName"]')
        await shareSends.trigger('click')
        await reviewName.trigger('click')
        await flushPromises()
        failFirst(new Error('offline'))
        await flushPromises()
        expect(shareSends.attributes('data-on')).toBe('true')
        expect(reviewName.attributes('data-on')).toBe('false')
    })

    it('leaves a toggle alone when a newer save already changed it', async () => {
        let failFirst: (error: Error) => void = () => undefined
        update
            .mockImplementationOnce(
                () => new Promise((_, reject) => (failFirst = reject)),
            )
            .mockResolvedValue({ id: 'me' })
        const wrapper = mountSettings({})
        const shareSends = wrapper.get('[data-testid="privacy-shareSends"]')
        await shareSends.trigger('click')
        await shareSends.trigger('click')
        await shareSends.trigger('click')
        await flushPromises()
        failFirst(new Error('offline'))
        await flushPromises()
        expect(shareSends.attributes('data-on')).toBe('false')
    })
})
