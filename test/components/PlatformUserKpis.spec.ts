import { mount } from '@vue/test-utils'
import UserKpis from '~/components/platform/UserKpis.vue'

const summary = {
    total: 10,
    new_7d: 2,
    active_7d: 5,
    online: 1,
    unverified: 1,
    unverified_old: 0,
    suspended: 1,
    locked: 0,
    platform_admins: 1,
    staff: 3,
    staff_no_mfa: 2,
}

function mountKpis(filter: string | null) {
    return mount(UserKpis, {
        props: { summary, modelValue: filter as never },
        global: { stubs: { LayoutStatCard: true } },
    })
}

describe('PlatformUserKpis', () => {
    it('shows who is online now on the active tile', () => {
        const card = mountKpis(null).get(
            '[data-testid="platform-user-kpi-active"] > *',
        )
        expect(card.attributes('subtitle')).toMatch(
            /^platform\.users\.kpis\.online/,
        )
    })

    it('sets the filter of a tile and clears it on a second click', async () => {
        const wrapper = mountKpis(null)
        await wrapper
            .get('[data-testid="platform-user-kpi-staff_no_mfa"]')
            .trigger('click')
        expect(wrapper.emitted('update:modelValue')).toEqual([['staff_no_mfa']])

        const active = mountKpis('staff_no_mfa')
        const tile = active.get(
            '[data-testid="platform-user-kpi-staff_no_mfa"]',
        )
        expect(tile.attributes('aria-pressed')).toBe('true')
        await tile.trigger('click')
        expect(active.emitted('update:modelValue')).toEqual([[null]])
    })
})
