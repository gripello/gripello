import { readFileSync } from 'node:fs'
import appConfig from '~/app.config'

const FIELDS = [
    'input',
    'inputNumber',
    'select',
    'selectMenu',
    'inputMenu',
    'textarea',
] as const

describe('app.config', () => {
    it('is a plain object, since Nuxt inlines it without auto-imports', () => {
        const source = readFileSync('app/app.config.ts', 'utf8')
        expect(source).not.toContain('defineAppConfig')
        expect(appConfig.ui.colors.primary).toBe('green')
    })

    it.each(FIELDS)(
        '%s keeps small sizes at 16px on touch so iOS does not zoom',
        (field) => {
            expect(appConfig.ui[field].compoundVariants).toContainEqual({
                size: ['xs', 'sm'],
                class: { base: 'pointer-coarse:text-base/4' },
            })
        },
    )
})
