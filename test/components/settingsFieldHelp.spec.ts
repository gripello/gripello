import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = (file: string) =>
    readFileSync(
        path.resolve(import.meta.dirname, `../../app/components/${file}`),
        'utf8',
    )

describe('settings fields', () => {
    it.each([
        'admin/GymSettingsForm.vue',
        'admin/settings/OrganizationSection.vue',
        'admin/settings/InfoSection.vue',
        'admin/settings/GradingSection.vue',
        'settings/LegalFields.vue',
    ])('%s explains fields below the input so rows stay aligned', (file) => {
        const fields = source(file).match(/<UFormField[^>]*>/g) ?? []
        expect(fields.length).toBeGreaterThan(0)
        for (const field of fields) expect(field).not.toMatch(/:description=/)
    })

    it('offers the default language with its explanation', () => {
        const form = source('admin/settings/OrganizationSection.vue')
        expect(form).toContain("$t('settings.defaultLanguage')")
        expect(form).toContain("$t('settings.defaultLanguageHelp')")
    })

    it('saves the short name used as push title', () => {
        expect(source('admin/settings/OrganizationSection.vue')).toContain(
            'v-model="form.short_name"',
        )
    })

    it('labels grade systems through translatedItems', () => {
        const grading = source('admin/settings/GradingSection.vue')
        expect(grading).toContain(
            "translatedItems(ROUTE_GRADE_SYSTEMS, 'gradeSystems', t)",
        )
        expect(grading).toContain(
            "translatedItems(BOULDER_GRADE_SYSTEMS, 'gradeSystems', t)",
        )
    })

    it('lets the object URL watcher set a newly picked asset preview', () => {
        const form = source('admin/GymSettingsForm.vue')
        const select = form.slice(
            form.indexOf('select(selected: File | null)'),
            form.indexOf('remove()'),
        )
        expect(select).toContain(
            'else if (reselected) preview.value = objectUrl.value ?? null',
        )
        expect(select).not.toMatch(/selected\s*\?\s*\(objectUrl/)
    })
})
