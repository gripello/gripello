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

function mountWith(logoUrl: string | null, record: GymRecord) {
    vi.stubGlobal('usePbFileUrl', () => logoUrl)
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
        const wrapper = mountWith('/logo.png', gym({ page_logo: 'logo.png' }))

        const logo = wrapper.get('img')
        expect(logo.attributes('src')).toBe('/logo.png')
        expect(logo.classes()).toContain('logo-mono')
        expect(logo.element.parentElement?.classList).toContain('bg-elevated')
    })

    it('falls back to initials without a logo', () => {
        const wrapper = mountWith(null, gym())

        expect(wrapper.find('img').exists()).toBe(false)
        expect(wrapper.text()).toContain('/dav')
    })
})
