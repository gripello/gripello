import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import CompetitionLifecycle from '~/components/competition/Lifecycle.vue'

const toDataURL = vi.hoisted(() =>
    vi.fn(async (text: string) => `data:image/png;base64,${text}`),
)
vi.mock('qrcode', () => ({ default: { toDataURL } }))

const success = vi.fn()
const writeText = vi.fn(async () => {})

beforeEach(() => {
    success.mockReset()
    writeText.mockClear()
    toDataURL.mockClear()
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({ success }))
    vi.stubGlobal('useRequestURL', () => new URL('https://gripello.test/x'))
    vi.stubGlobal('useGym', () => ({ slug: ref('hall') }))
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
    })
})

const DAY = 86_400_000
const competition = (status: string, startsIn = DAY, endsIn = 2 * DAY) => ({
    id: 'c1',
    status,
    starts_at: new Date(Date.now() + startsIn).toISOString(),
    ends_at: new Date(Date.now() + endsIn).toISOString(),
})
const CHECKLIST = [
    { step: 'details', done: true },
    { step: 'routes', done: false },
]

function mountLifecycle(
    status: string,
    checklist = CHECKLIST,
    times: [number, number] = [DAY, 2 * DAY],
) {
    return mount(CompetitionLifecycle, {
        props: {
            competition: competition(status, ...times),
            checklist,
        } as never,
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutPanel: { template: '<section><slot /></section>' },
                UStepper: true,
                UInput: {
                    props: ['modelValue'],
                    template:
                        '<input data-testid="competition-share-url" :value="modelValue" />',
                },
                UBadge: {
                    template:
                        '<span data-testid="competition-phase"><slot /></span>',
                },
                UPopover: {
                    template: '<div><slot /><slot name="content" /></div>',
                },
                UDropdownMenu: {
                    props: ['items'],
                    template: `<div><button v-for="item in items" :key="item.label"
                        :data-testid="item['data-testid']" @click="item.onSelect()" /></div>`,
                },
                UButton: {
                    inheritAttrs: false,
                    props: ['disabled'],
                    emits: ['click'],
                    template: `<button :data-testid="$attrs['data-testid']" :disabled="disabled"
                        @click="$emit('click')"><slot /></button>`,
                },
                ConfirmDialog: {
                    props: ['modelValue', 'message'],
                    emits: ['confirm'],
                    template: `<button v-if="modelValue" data-testid="confirm"
                        :data-message="message" @click="$emit('confirm')" />`,
                },
            },
        },
    })
}

const phase = (wrapper: ReturnType<typeof mountLifecycle>) =>
    wrapper.get('[data-testid="competition-phase"]').text()

describe('CompetitionLifecycle', () => {
    it('opens a draft only once the checklist is done and after a confirm', async () => {
        const wrapper = mountLifecycle('draft')
        expect(phase(wrapper)).toBe('competitions.phases.draft.title')
        const open = wrapper.get('[data-testid="competition-action-open"]')
        expect(open.attributes()).toHaveProperty('disabled')
        expect(wrapper.find('[data-testid="competition-share"]').exists()).toBe(
            false,
        )

        await wrapper
            .get('[data-testid="competition-checklist-routes"]')
            .trigger('click')
        expect(wrapper.emitted('goto')).toEqual([['routes']])

        await wrapper.setProps({
            checklist: CHECKLIST.map((item) => ({ ...item, done: true })),
        })
        expect(open.attributes()).not.toHaveProperty('disabled')
        await open.trigger('click')
        expect(wrapper.emitted('status')).toBeUndefined()
        expect(
            wrapper.get('[data-testid="confirm"]').attributes('data-message'),
        ).toBe('competitions.confirm.open')
        await wrapper.get('[data-testid="confirm"]').trigger('click')
        expect(wrapper.emitted('status')).toEqual([['open']])
        expect(wrapper.find('[data-testid="confirm"]').exists()).toBe(false)
    })

    it.each([
        ['open', 'close', 'closed', 'backToDraft', 'draft'],
        ['closed', 'publish', 'published', 'reopen', 'open'],
    ])(
        'a %s competition offers %s and %s',
        async (status, primary, primaryTarget, secondary, secondaryTarget) => {
            const wrapper = mountLifecycle(status)
            await wrapper
                .get(`[data-testid="competition-action-${primary}"]`)
                .trigger('click')
            await wrapper.get('[data-testid="confirm"]').trigger('click')
            await wrapper
                .get(`[data-testid="competition-action-${secondary}"]`)
                .trigger('click')
            await wrapper.get('[data-testid="confirm"]').trigger('click')
            expect(wrapper.emitted('status')).toEqual([
                [primaryTarget],
                [secondaryTarget],
            ])
            expect(
                wrapper.find('[data-testid="competition-checklist"]').exists(),
            ).toBe(false)
        },
    )

    it('only unpublishes a published competition', async () => {
        const wrapper = mountLifecycle('published')
        expect(phase(wrapper)).toBe('competitions.phases.published.title')
        expect(
            wrapper.findAll('[data-testid^="competition-action-"]'),
        ).toHaveLength(1)
        await wrapper
            .get('[data-testid="competition-action-unpublish"]')
            .trigger('click')
        await wrapper.get('[data-testid="confirm"]').trigger('click')
        expect(wrapper.emitted('status')).toEqual([['closed']])
    })

    it('derives registration, running and ended from the dates of an open competition', () => {
        expect(phase(mountLifecycle('open'))).toBe(
            'competitions.phases.registration.title',
        )
        expect(phase(mountLifecycle('open', CHECKLIST, [-DAY, DAY]))).toBe(
            'competitions.phases.running.title',
        )
        expect(phase(mountLifecycle('open', CHECKLIST, [-2 * DAY, -DAY]))).toBe(
            'competitions.phases.ended.title',
        )
    })

    it('shares the public link with a copy button and a QR code rendered once', async () => {
        const wrapper = mountLifecycle('open')
        const url = 'https://gripello.test/hall/competitions/c1'
        expect(
            (
                wrapper.get('[data-testid="competition-share-url"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe(url)
        await wrapper
            .get('[data-testid="competition-share-copy"]')
            .trigger('click')
        await flushPromises()
        expect(writeText).toHaveBeenCalledWith(url)
        expect(success).toHaveBeenCalledWith('competitions.linkCopied')

        await wrapper.get('[data-testid="competition-share"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-testid="competition-share"]').trigger('click')
        await flushPromises()
        expect(toDataURL).toHaveBeenCalledOnce()
        expect(toDataURL).toHaveBeenCalledWith(url, expect.anything())
        expect(
            wrapper
                .get('[data-testid="competition-share-qr"]')
                .attributes('src'),
        ).toBe(`data:image/png;base64,${url}`)
    })
})
