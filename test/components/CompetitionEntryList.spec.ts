import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import CompetitionEntryList from '~/components/competition/EntryList.vue'
import {
    listCompetitionEntries,
    updateCompetitionEntry,
} from '~/api/competitions'
import { useAsyncAction } from '~/composables/useAsyncAction'

vi.mock('~/api/competitions', () => ({
    listCompetitionEntries: vi.fn(),
    updateCompetitionEntry: vi.fn(),
}))

const notifyError = vi.fn()
let live: (event: { kind: string }) => void

const entry = (bib: number, status: string, extra = {}) => ({
    id: `e${bib}`,
    bib,
    status,
    paid: false,
    display_name: `Climber ${bib}`,
    birth_year: 1990,
    expand: { category: { name: 'Adults' } },
    ...extra,
})

beforeEach(() => {
    notifyError.mockReset()
    vi.mocked(listCompetitionEntries)
        .mockReset()
        .mockResolvedValue([
            entry(1, 'registered', { paid: true }),
            entry(2, 'checked_in'),
            entry(3, 'withdrawn', { paid: true }),
            entry(4, 'disqualified'),
        ] as never)
    vi.mocked(updateCompetitionEntry)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({
        success: vi.fn(),
        error: notifyError,
    }))
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    vi.stubGlobal('coalesce', (fn: () => void) => fn)
    vi.stubGlobal(
        'useCompetitionLive',
        (_id: unknown, handler: typeof live) => (live = handler),
    )
})

async function mountList(props: Record<string, unknown> = {}) {
    const wrapper = mount(CompetitionEntryList, {
        props: { competitionId: 'c1', ...props },
        global: {
            mocks: {
                $t: (key: string, params?: { n?: number }) =>
                    params?.n === undefined ? key : `${key}:${params.n}`,
            },
            stubs: {
                LayoutEmptyState: {
                    template: '<p data-testid="entries-empty" />',
                },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input data-testid="competition-entries-search" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UBadge: { template: '<span v-bind="$attrs"><slot /></span>' },
                USwitch: {
                    inheritAttrs: false,
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input type="checkbox" :data-testid="$attrs['data-testid']"
                        :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)" />`,
                },
                UButton: {
                    inheritAttrs: false,
                    emits: ['click'],
                    template:
                        '<button :data-testid="$attrs[\'data-testid\']" @click="$emit(\'click\')"><slot /></button>',
                },
                UDropdownMenu: {
                    props: ['items'],
                    template: `<div><slot /><button v-for="item in items" :key="item.label"
                        :data-testid="item['data-testid'] ?? item.label" @click="item.onSelect()" /></div>`,
                },
            },
        },
    })
    await flushPromises()
    return wrapper
}

const bibs = (wrapper: Awaited<ReturnType<typeof mountList>>) =>
    wrapper
        .findAll('li')
        .map((row) => row.attributes('data-testid')!.replace(/\D/g, ''))
const status = (wrapper: Awaited<ReturnType<typeof mountList>>, bib: number) =>
    wrapper.get(`[data-testid="competition-entry-status-${bib}"]`).text()

describe('CompetitionEntryList', () => {
    it('counts only active entries and finds climbers by name or exact bib', async () => {
        const wrapper = await mountList({ requiresPayment: true })
        expect(wrapper.text()).toContain('competitions.entryCount:2')
        expect(wrapper.text()).toContain('competitions.checkedInCount:1')
        expect(wrapper.text()).toContain('competitions.paidCount:1')

        const search = wrapper.get('[data-testid="competition-entries-search"]')
        await search.setValue('  CLIMBER 3 ')
        expect(bibs(wrapper)).toEqual(['3'])
        await search.setValue('1')
        expect(bibs(wrapper)).toEqual(['1'])
        await search.setValue('')
        expect(bibs(wrapper)).toEqual(['1', '2', '3', '4'])
    })

    it('shows payment switches only when the competition charges', async () => {
        expect(
            (await mountList())
                .find('[data-testid="competition-entry-paid-1"]')
                .exists(),
        ).toBe(false)
        const wrapper = await mountList({ requiresPayment: true })
        await wrapper
            .get('[data-testid="competition-entry-paid-2"]')
            .setValue(true)
        expect(updateCompetitionEntry).toHaveBeenCalledWith('e2', {
            paid: true,
        })
        await flushPromises()
        expect(wrapper.text()).toContain('competitions.paidCount:2')
    })

    it('checks in registered climbers only while check-in is on', async () => {
        const off = await mountList()
        expect(
            off.find('[data-testid="competition-entry-checkin-1"]').exists(),
        ).toBe(false)

        const wrapper = await mountList({ checkIn: true })
        expect(
            wrapper
                .find('[data-testid="competition-entry-checkin-2"]')
                .exists(),
        ).toBe(false)
        await wrapper
            .get('[data-testid="competition-entry-checkin-1"]')
            .trigger('click')
        expect(status(wrapper, 1)).toBe('competitions.entryStatuses.checked_in')
        await flushPromises()
        expect(updateCompetitionEntry).toHaveBeenCalledWith('e1', {
            status: 'checked_in',
        })
        expect(wrapper.text()).toContain('competitions.checkedInCount:2')
    })

    it('puts the entry back when a change fails to save', async () => {
        vi.mocked(updateCompetitionEntry).mockRejectedValue(new Error('down'))
        const wrapper = await mountList({ checkIn: true })
        await wrapper
            .get('[data-testid="competition-entry-checkin-1"]')
            .trigger('click')
        await flushPromises()
        expect(status(wrapper, 1)).toBe('competitions.entryStatuses.registered')
        expect(notifyError).toHaveBeenCalled()
    })

    it('offers undo check-in, disqualify or reinstate per status', async () => {
        const wrapper = await mountList()
        const menu = (bib: number) =>
            wrapper
                .get(`[data-testid="competition-entry-${bib}"]`)
                .findAll('button')
                .map((button) => button.attributes('data-testid'))
                .filter((id) => id && !id.includes('-menu-'))
        expect(menu(1)).toEqual(['competition-entry-disqualify-1'])
        expect(menu(2)).toEqual([
            'competitions.undoCheckIn',
            'competition-entry-disqualify-2',
        ])
        expect(menu(3)).toEqual(['competition-entry-reinstate-3'])

        await wrapper
            .get('[data-testid="competition-entry-reinstate-4"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="competition-entry-disqualify-1"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="competition-entry-2"]')
            .get('[data-testid="competitions.undoCheckIn"]')
            .trigger('click')
        expect(vi.mocked(updateCompetitionEntry).mock.calls).toEqual([
            ['e4', { status: 'registered' }],
            ['e1', { status: 'disqualified' }],
            ['e2', { status: 'registered' }],
        ])
    })

    it('shows an empty state and refreshes on entry and category changes', async () => {
        vi.mocked(listCompetitionEntries).mockResolvedValue([] as never)
        const wrapper = await mountList()
        expect(wrapper.find('[data-testid="entries-empty"]').exists()).toBe(
            true,
        )
        expect(listCompetitionEntries).toHaveBeenCalledOnce()
        live({ kind: 'scores' })
        expect(listCompetitionEntries).toHaveBeenCalledOnce()
        live({ kind: 'entries' })
        live({ kind: 'categories' })
        live({ kind: 'resync' })
        expect(listCompetitionEntries).toHaveBeenCalledTimes(4)
    })
})
