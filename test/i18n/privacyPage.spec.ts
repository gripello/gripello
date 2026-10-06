import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'

const RENDERED_ELSEWHERE = ['subtitle', 'controllerTitle', 'storage', 'rights']

describe('privacy page', () => {
    it('renders every privacy section in the locale files', () => {
        const source = readFileSync(
            'app/components/legal/PrivacyDoc.vue',
            'utf8',
        )
        const sections = Object.keys(en.legal.privacyPage).filter(
            (key) => !RENDERED_ELSEWHERE.includes(key),
        )
        for (const section of sections) expect(source).toContain(`'${section}'`)
    })
})
