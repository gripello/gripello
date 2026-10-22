import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, toValue } from 'vue'
import { useDirectionsHref } from '~/composables/useDirectionsHref'

function hrefFor(gym: {
    latitude?: number
    longitude?: number
    address?: string
}) {
    let href = ref('')
    mount(
        defineComponent({
            setup() {
                href = useDirectionsHref(() => gym) as never
                return () => h('div')
            },
        }),
    )
    return href
}

describe('useDirectionsHref', () => {
    beforeEach(() => vi.stubGlobal('toValue', toValue))
    afterEach(() => vi.restoreAllMocks())

    it('has no link without coordinates', () => {
        expect(hrefFor({ address: 'Boulderweg 7' }).value).toBe('')
    })

    it('picks the maps app of the device once mounted', async () => {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (iPhone)',
        )
        const href = hrefFor({
            latitude: 50.1,
            longitude: 8.9,
            address: 'Boulderweg 7',
        })
        await nextTick()
        expect(href.value).toMatch(/^https:\/\/maps\.apple\.com\//)
    })
})
