import { mount } from '@vue/test-utils'
import AddressBlock from '~/components/gym/AddressBlock.vue'

function createWrapper(gym: Record<string, unknown>) {
    return mount(AddressBlock, {
        props: { gym } as never,
        global: { stubs: { UIcon: true, GymDirectionsButton: true } },
    })
}

describe('GymAddressBlock', () => {
    beforeEach(() => {
        vi.stubGlobal('useDirectionsHref', () =>
            computed(() => 'https://maps.test'),
        )
    })

    it('splits the address into street and town and links it to directions', () => {
        const address = createWrapper({
            address: 'Boulderweg 7, 12345 Musterstadt',
            latitude: 50,
            longitude: 8,
        }).get('[data-testid="gym-info-address"]')
        expect(address.element.tagName).toBe('A')
        expect(address.attributes('href')).toBe('https://maps.test')
        expect(address.text()).toContain('Boulderweg 7')
        expect(address.text()).toContain('12345 Musterstadt')
    })

    it('leaves out the address line when only coordinates are known', () => {
        const wrapper = createWrapper({
            address: '',
            latitude: 50,
            longitude: 8,
        })
        expect(wrapper.find('[data-testid="gym-info-address"]').exists()).toBe(
            false,
        )
    })
})
