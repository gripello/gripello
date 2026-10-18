import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import RouteEditor from '~/components/competition/RouteEditor.vue'
import type { CompetitionRecord } from '~/types/models'

beforeEach(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useCompetitionLive', vi.fn())
    vi.stubGlobal('useLiveRefresh', vi.fn())
    vi.stubGlobal('useAsyncAction', () => ({
        pending: ref(false),
        run: vi.fn(),
    }))
    vi.stubGlobal('useAsyncData', (key: () => string) => ({
        data: ref(
            key().startsWith('competition-routes')
                ? [{ id: 'cr1', route: 'r1', number: 1, hold_count: 0 }]
                : [],
        ),
        refresh: vi.fn(),
    }))
})

describe('CompetitionRouteEditor', () => {
    it('leaves the hold count empty while it is unset', () => {
        const wrapper = mount(RouteEditor, {
            props: {
                competition: {
                    id: 'c1',
                    discipline: 'rope',
                    scoring_format: 'lead_height',
                    status: 'draft',
                } as CompetitionRecord,
            },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    UInputNumber: {
                        props: ['modelValue'],
                        template: '<input :value="String(modelValue)" />',
                    },
                    UFormField: { template: '<div><slot /></div>' },
                    USelectMenu: true,
                    UButton: true,
                    USwitch: true,
                    RouteSummary: true,
                    LayoutEmptyState: true,
                },
            },
        })
        expect(
            (
                wrapper.get('[data-testid="competition-route-holds-1"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('undefined')
    })
})
