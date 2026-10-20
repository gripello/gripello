import { readFileSync } from 'node:fs'

const switcher = readFileSync('app/components/layout/GymSwitcher.vue', 'utf8')
const brand = readFileSync('app/components/layout/BrandLogo.vue', 'utf8')
const images = (source: string) => source.match(/<img[^>]*>/g) ?? []

describe('gym logos', () => {
    it('leaves the switcher logo out of the accessible name, which the button already carries', () => {
        expect(images(switcher).length).toBeGreaterThan(0)
        for (const img of images(switcher)) expect(img).toContain('alt=""')
        expect(switcher).toMatch(/:aria-label="\s+currentGym \? `\$\{title\}/)
    })

    it('reserves the size of the built-in logos before they load', () => {
        for (const img of [...images(switcher), ...images(brand)].filter(
            (img) => /src="\/(app-icon|gripello-)/.test(img),
        )) {
            expect(img).toMatch(/width="\d+"/)
            expect(img).toMatch(/height="\d+"/)
        }
    })
})
