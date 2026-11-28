import { readFileSync } from 'node:fs'

const css = readFileSync('app/assets/css/main.css', 'utf8')
const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

describe('reduced motion', () => {
    it('shortens every animation and transition except the TV slide progress', () => {
        expect(block).toMatch(
            /\*:not\(\s*\.tv-progress,[^)]*\),\s*::before,\s*::after\s*\{[^}]*animation-duration: 0\.01ms !important;[^}]*transition-duration: 0\.01ms !important;/,
        )
        expect(block).toMatch(/scroll-behavior: auto !important/)
    })

    it('keeps progress indicators moving', () => {
        const exempt = block.slice(
            block.indexOf('*:not('),
            block.indexOf('::before'),
        )
        expect(exempt).toContain('.animate-spin')
        expect(exempt).toContain("[class*='animate-[spin']")
        expect(exempt).toContain("[data-state='indeterminate']")
    })

    it('exempts the class the TV progress bar really uses', () => {
        expect(readFileSync('app/pages/[gym]/tv.vue', 'utf8')).toContain(
            'class="tv-progress ',
        )
    })
})
