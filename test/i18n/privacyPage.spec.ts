import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import { PRIVACY_TEXT_SECTIONS } from '#shared/utils/privacyDoc'

const RENDERED_ELSEWHERE = ['subtitle', 'controllerTitle', 'storage', 'rights']

describe('privacy page', () => {
    it('offers every privacy section in the locale files as a block', () => {
        const sections = Object.keys(en.legal.privacyPage).filter(
            (key) => !RENDERED_ELSEWHERE.includes(key),
        )
        expect([...PRIVACY_TEXT_SECTIONS].sort()).toEqual(sections.sort())
    })
})
