import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import de from '../../i18n/locales/de.json'
import RouteHero from '~/components/route/Hero.vue'
import RouteStatsBar from '~/components/route/StatsBar.vue'
import LayoutStatTile from '~/components/layout/StatTile.vue'
import type { ReviewDisplay } from '~/utils/routeReviews'
import type { RouteListItem } from '~/types/models'

const i18n = createI18n({ legacy: false, locale: 'de', messages: { de } })
vi.stubGlobal('useI18n', () => i18n.global)
vi.stubGlobal('useGoBack', () => ({ goBack: () => {} }))
vi.stubGlobal('useThemeColors', () => ref({ primary: '#228b22' }))
vi.stubGlobal('useGymBands', () => ({
    bands: ref([]),
    bandName: () => '',
}))

const review = (
    difficultyLabel: string,
    rating: number | null = null,
): ReviewDisplay => ({
    id: Math.random().toString(),
    rating,
    difficultyLabel,
    comment: null,
    created: '',
    userName: '',
    userAvatar: null,
    mine: false,
})

const route = {
    id: 'r1',
    name: 'Nordwand',
    type: 'Boulder',
    grade: '4',
    grade_system: 'french',
    color: '#ff0000',
    creator: [],
} as unknown as RouteListItem

const dialogOpened = vi.fn()

function mountHero(reviews: ReviewDisplay[]) {
    return mount(RouteHero, {
        props: { route, ticked: false, reviews },
        global: {
            stubs: {
                UButton: true,
                UIcon: { template: '<i :data-icon="name" />', props: ['name'] },
                UBadge: { template: '<span><slot /></span>' },
                GradeConversionDialog: {
                    template:
                        '<div><slot name="activator" :props="{ onClick: open }" /></div>',
                    methods: { open: dialogOpened },
                },
            },
        },
    })
}

describe('RouteHero', () => {
    it('opens the grade conversion from the whole grade card', async () => {
        const wrapper = mountHero([])
        const card = wrapper.get('[data-testid="route-grade-badge"]')
        expect(card.attributes('aria-label')).toBe(
            'Mit anderen Skalen vergleichen',
        )
        const convert = card.get('[data-testid="route-grade-conversion"]')
        expect(convert.attributes('aria-hidden')).toBe('true')
        expect(
            convert.find('[data-icon="i-lucide-arrow-left-right"]').exists(),
        ).toBe(true)
        await convert.trigger('click')
        expect(dialogOpened).toHaveBeenCalledOnce()
        expect(wrapper.text()).not.toContain('Umrechnungstabelle')
    })

    it('hides the felt grade until someone voted', () => {
        expect(
            mountHero([review('', 4)])
                .find('[data-testid="route-perceived-grade"]')
                .exists(),
        ).toBe(false)
    })

    it('shows the most voted grade with the number of votes', () => {
        const pill = (reviews: ReviewDisplay[]) =>
            mountHero(reviews)
                .get('[data-testid="route-perceived-grade"]')
                .text()
                .replace(/\s+/g, ' ')
        expect(pill([review('4+')])).toBe('Gefühlt 4+ · 1 Stimme')
        expect(
            pill([review('4+'), review('5'), review('4+'), review('')]),
        ).toBe('Gefühlt 4+ · 3 Stimmen')
    })
})

describe('RouteStatsBar', () => {
    function values(props: InstanceType<typeof RouteStatsBar>['$props']) {
        const wrapper = mount(RouteStatsBar, {
            props,
            global: {
                components: { LayoutStatTile },
                stubs: { UIcon: true, USeparator: true },
            },
        })
        return ['route-avg-rating', 'route-sends', 'route-screw-date'].map(
            (id) => wrapper.get(`[data-testid="${id}"]`).text(),
        )
    }

    it('shows stars, distinct senders and the short set date', () => {
        expect(
            values({
                reviews: [review('', 4), review('', 5), review('5')],
                sendsCount: 7,
                screwDate: '2026-10-12',
            }),
        ).toEqual(['4,52 Bewertungen', '7Begehungen', '12.10.Geschraubt'])
    })

    it('falls back to dashes without data', () => {
        expect(values({ reviews: [], screwDate: null })).toEqual([
            '—0 Bewertungen',
            '—Begehungen',
            '—Geschraubt',
        ])
    })

    it('counts a single rating in the singular', () => {
        expect(values({ reviews: [review('', 3)] })[0]).toBe('3,01 Bewertung')
    })
})
