import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import CompetitionScorecard from '~/components/competition/Scorecard.vue'
import { listCompetitionRoutes } from '~/api/competitions'

vi.mock('~/api/competitions', () => ({ listCompetitionRoutes: vi.fn() }))

const act = vi.fn()
const load = vi.fn()
const scores = ref<Record<string, unknown>>({})
const pendingCount = ref(0)
const offline = ref(false)
let live: (event: { kind: string; entry?: string }) => void

beforeEach(() => {
    act.mockReset()
    load.mockReset()
    scores.value = {}
    pendingCount.value = 0
    offline.value = false
    vi.mocked(listCompetitionRoutes)
        .mockReset()
        .mockResolvedValue([
            { id: 'cr1', number: 1, zone: true },
            { id: 'cr2', number: 2, zone: false },
        ] as never)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useScorecard', () => ({
        scores,
        pendingCount,
        offline,
        load,
        act,
    }))
    vi.stubGlobal('coalesce', (fn: () => void) => fn)
    vi.stubGlobal(
        'useCompetitionLive',
        (_id: unknown, handler: typeof live) => (live = handler),
    )
})

async function mountScorecard(discipline = 'boulder') {
    const wrapper = mount(CompetitionScorecard, {
        props: {
            competition: { id: 'c1', discipline },
            entry: { id: 'e1' },
        } as never,
        global: {
            mocks: {
                $t: (key: string, params?: { n?: number }) =>
                    params?.n === undefined ? key : `${key}:${params.n}`,
            },
            stubs: {
                LayoutPanel: {
                    template:
                        '<section><slot name="actions" /><slot /></section>',
                },
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutListRow: { template: '<li><slot /></li>' },
                LayoutEmptyState: {
                    template: '<p data-testid="scorecard-empty" />',
                },
                SegmentedControl: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<div><button v-for="f in ['all', 'open', 'topped']" :key="f"
                        :data-testid="'filter-' + f" @click="$emit('update:modelValue', f)" /></div>`,
                },
                RouteSummary: true,
                UBadge: {
                    template: '<span v-bind="$attrs"><slot /></span>',
                },
                CompetitionAttemptStepper: {
                    props: ['testIdSuffix', 'addDisabled'],
                    emits: ['add', 'undo'],
                    template: `<span><button :data-testid="'add-' + testIdSuffix"
                        :disabled="addDisabled" @click="$emit('add')" />
                        <button :data-testid="'undo-' + testIdSuffix" @click="$emit('undo')" /></span>`,
                },
                UButton: {
                    inheritAttrs: false,
                    props: ['disabled'],
                    emits: ['click'],
                    template: `<button :data-testid="$attrs['data-testid']" :disabled="disabled"
                        :aria-pressed="$attrs['aria-pressed']" @click="$emit('click')"><slot /></button>`,
                },
            },
        },
    })
    await flushPromises()
    return wrapper
}

const score = (attempts: number, topAttempt: number, zoneAttempt = 0) => ({
    attempts,
    topAttempt,
    zoneAttempt,
    style: '',
})

describe('CompetitionScorecard', () => {
    it('loads the entry and scores only the routes still counting', async () => {
        const wrapper = await mountScorecard()
        expect(load).toHaveBeenCalledOnce()
        expect(listCompetitionRoutes).toHaveBeenCalledWith('c1', {
            voided: false,
        })
        expect(wrapper.find('[data-testid="scorecard-route-1"]').exists()).toBe(
            true,
        )
        expect(wrapper.find('[data-testid="scorecard-zone-1"]').exists()).toBe(
            true,
        )
        expect(wrapper.find('[data-testid="scorecard-zone-2"]').exists()).toBe(
            false,
        )
        expect(
            wrapper.find('[data-testid="scorecard-style-1-lead"]').exists(),
        ).toBe(false)
    })

    it('sends attempts, zones and tops for the tapped route', async () => {
        const wrapper = await mountScorecard()
        await wrapper.get('[data-testid="add-1"]').trigger('click')
        await wrapper.get('[data-testid="undo-1"]').trigger('click')
        await wrapper.get('[data-testid="scorecard-zone-1"]').trigger('click')
        await wrapper.get('[data-testid="scorecard-top-2"]').trigger('click')
        expect(act.mock.calls).toEqual([
            [expect.objectContaining({ id: 'cr1' }), { type: 'attempt' }],
            [expect.objectContaining({ id: 'cr1' }), { type: 'undoAttempt' }],
            [expect.objectContaining({ id: 'cr1' }), { type: 'zone' }],
            [expect.objectContaining({ id: 'cr2' }), { type: 'top' }],
        ])
    })

    it('locks attempts and zone once topped and counts tops and flashes', async () => {
        scores.value = { cr1: score(1, 1, 1), cr2: score(3, 3) }
        const wrapper = await mountScorecard()
        expect(
            wrapper.get('[data-testid="add-1"]').attributes(),
        ).toHaveProperty('disabled')
        expect(
            wrapper.get('[data-testid="scorecard-zone-1"]').attributes(),
        ).toHaveProperty('disabled')
        expect(wrapper.get('[data-testid="scorecard-top-1"]').text()).toBe(
            'competitions.scorecard.flash',
        )
        expect(wrapper.get('[data-testid="scorecard-top-2"]').text()).toBe(
            'competitions.scorecard.top',
        )
        expect(wrapper.get('[data-testid="scorecard-tops"]').text()).toBe(
            'competitions.scorecard.tops:2',
        )
        expect(wrapper.text()).toContain('competitions.scorecard.flashes:1')
    })

    it('picks a climbing style on rope competitions, lead by default', async () => {
        scores.value = { cr2: { ...score(1, 0), style: 'toprope' } }
        const wrapper = await mountScorecard('rope')
        expect(
            wrapper
                .get('[data-testid="scorecard-style-1-lead"]')
                .attributes('aria-pressed'),
        ).toBe('true')
        expect(
            wrapper
                .get('[data-testid="scorecard-style-2-toprope"]')
                .attributes('aria-pressed'),
        ).toBe('true')
        await wrapper
            .get('[data-testid="scorecard-style-1-toprope"]')
            .trigger('click')
        expect(act).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'cr1' }),
            {
                type: 'style',
                style: 'toprope',
            },
        )
    })

    it('filters open and topped routes', async () => {
        scores.value = { cr1: score(2, 2) }
        const wrapper = await mountScorecard()
        await wrapper.get('[data-testid="filter-open"]').trigger('click')
        expect(wrapper.find('[data-testid="scorecard-route-1"]').exists()).toBe(
            false,
        )
        expect(wrapper.find('[data-testid="scorecard-route-2"]').exists()).toBe(
            true,
        )
        await wrapper.get('[data-testid="filter-topped"]').trigger('click')
        expect(wrapper.find('[data-testid="scorecard-route-2"]').exists()).toBe(
            false,
        )
        scores.value = {}
        await flushPromises()
        expect(wrapper.find('[data-testid="scorecard-empty"]').exists()).toBe(
            true,
        )
    })

    it('shows unsaved scores and whether they wait for the network', async () => {
        const wrapper = await mountScorecard()
        expect(wrapper.find('[data-testid="scorecard-pending"]').exists()).toBe(
            false,
        )
        pendingCount.value = 2
        await flushPromises()
        expect(wrapper.get('[data-testid="scorecard-pending"]').text()).toBe(
            'competitions.scorecard.saving',
        )
        offline.value = true
        await flushPromises()
        expect(wrapper.get('[data-testid="scorecard-pending"]').text()).toBe(
            'competitions.scorecard.offline:2',
        )
    })

    it('reloads on score changes of this entry and on resync only', async () => {
        await mountScorecard()
        load.mockClear()
        live({ kind: 'scores', entry: 'other' })
        live({ kind: 'entries' })
        expect(load).not.toHaveBeenCalled()
        live({ kind: 'scores', entry: 'e1' })
        live({ kind: 'resync' })
        expect(load).toHaveBeenCalledTimes(2)
    })
})
