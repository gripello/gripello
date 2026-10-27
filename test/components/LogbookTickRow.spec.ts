import { mount } from '@vue/test-utils'
import TickRow from '~/components/logbook/TickRow.vue'
import type { TickRecord } from '~/types/models'

function mountRow(syncFailed?: string, expand?: TickRecord['expand']) {
    return mount(TickRow, {
        props: {
            tick: {
                id: 't1',
                route: 'r1',
                type: 'flash',
                attempts: 1,
                route_name: 'Arete',
                syncFailed,
                expand,
            } as TickRecord & { syncFailed?: string },
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                RouteSummary: {
                    props: ['route'],
                    template:
                        '<div><span data-testid="name">{{ route.name }}</span><slot name="meta" /></div>',
                },
                UBadge: { template: '<span><slot /></span>' },
                UDropdownMenu: true,
                UButton: true,
            },
        },
    })
}

describe('LogbookTickRow', () => {
    it('flags a failed sync with the translated badge, never the raw server text', () => {
        const wrapper = mountRow(
            '[POST] "/api/ticks": 500 Internal Server Error',
        )
        expect(
            wrapper.find('[data-testid="logbook-tick-sync-failed"]').text(),
        ).toBe('ticks.syncFailed')
        expect(wrapper.html()).not.toContain('Internal Server Error')
    })

    it('keeps a moderation-blanked route name blank instead of the snapshot', () => {
        const wrapper = mountRow(undefined, {
            route: { id: 'r1', name: '' },
        } as TickRecord['expand'])
        expect(wrapper.find('[data-testid="name"]').text()).toBe('')
        expect(mountRow().find('[data-testid="name"]').text()).toBe('Arete')
    })
})
