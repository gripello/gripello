import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import GymIdentity from '~/components/platform/GymIdentity.vue'
import type { GymRecord } from '~/types/models'

const gym = (extra: Partial<GymRecord> = {}) =>
    ({
        id: 'g1',
        slug: 'dav',
        name: 'DAV',
        active: true,
        ...extra,
    }) as GymRecord

let hydrated = true
vi.stubGlobal('useHydrated', () => ref(hydrated))

function mountWith(record: GymRecord) {
    return mount(GymIdentity, {
        props: { gym: record },
        global: {
            stubs: { UBadge: true },
            mocks: { $t: (key: string) => key },
        },
    })
}

describe('GymIdentity', () => {
    it('renders the logo monochrome so white logos stay visible', () => {
        const wrapper = mountWith(gym({ page_logo: 'logo.png' }))

        const logo = wrapper.get('img')
        expect(logo.attributes('src')).toBe(
            '/api/files/gyms/g1/logo.png?thumb=0x200',
        )
        expect(logo.classes()).toContain('logo-mono')
        expect(logo.element.parentElement?.classList).toContain('bg-elevated')
    })

    it('marks inactive and invisible gyms', () => {
        expect(
            mountWith(gym({ active: false, hidden: true }))
                .find('[data-testid="platform-gym-inactive-dav"]')
                .exists(),
        ).toBe(true)
        const hidden = mountWith(gym({ hidden: true }))
        expect(
            hidden.find('[data-testid="platform-gym-hidden-dav"]').exists(),
        ).toBe(true)
        expect(
            mountWith(gym())
                .find('[data-testid="platform-gym-hidden-dav"]')
                .exists(),
        ).toBe(false)
    })

    it('falls back to initials without a logo', () => {
        const wrapper = mountWith(gym())

        expect(wrapper.find('img').exists()).toBe(false)
        expect(wrapper.text()).toContain('/dav')
    })

    it('shows the trial only after hydration, so SSR markup does not depend on the clock', () => {
        const trial = gym({ trial_ends_at: '2099-01-01T00:00:00Z' })
        hydrated = false
        expect(
            mountWith(trial)
                .find('[data-testid="platform-gym-trial-dav"]')
                .exists(),
        ).toBe(false)
        hydrated = true
        expect(
            mountWith(trial)
                .find('[data-testid="platform-gym-trial-dav"]')
                .exists(),
        ).toBe(true)
    })
})
