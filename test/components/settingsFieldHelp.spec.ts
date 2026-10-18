import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = (file: string) =>
    readFileSync(
        path.resolve(import.meta.dirname, `../../app/components/${file}`),
        'utf8',
    )

describe('settings fields', () => {
    it.each(['admin/GymSettingsForm.vue', 'settings/LegalFields.vue'])(
        '%s explains fields below the input so rows stay aligned',
        (file) => {
            const fields = source(file).match(/<UFormField[^>]*>/g) ?? []
            expect(fields.length).toBeGreaterThan(0)
            for (const field of fields)
                expect(field).not.toMatch(/:description=/)
        },
    )

    it('offers the default language with its explanation', () => {
        const form = source('admin/GymSettingsForm.vue')
        expect(form).toContain("$t('settings.defaultLanguage')")
        expect(form).toContain("$t('settings.defaultLanguageHelp')")
    })

    it('saves the short name used as push title', () => {
        const form = source('admin/GymSettingsForm.vue')
        expect(form).toContain('v-model="copySettings.short_name"')
        expect(form).toContain('short_name: state.short_name')
        expect(form).toContain('original.short_name = rec.short_name')
    })
})
