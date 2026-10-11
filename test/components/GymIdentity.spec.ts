import { mount } from '@vue/test-utils'
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

    it('falls back to initials without a logo', () => {
        const wrapper = mountWith(gym())

        expect(wrapper.find('img').exists()).toBe(false)
        expect(wrapper.text()).toContain('/dav')
    })
})
