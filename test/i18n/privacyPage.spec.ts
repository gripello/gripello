import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import de from '../../i18n/locales/de.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import nl from '../../i18n/locales/nl.json'
import { PRIVACY_TEXT_SECTIONS } from '#shared/utils/privacyDoc'

const RENDERED_ELSEWHERE = ['subtitle', 'controllerTitle', 'storage', 'rights']

describe('privacy page', () => {
    it('offers every privacy section in the locale files as a block', () => {
        const sections = Object.keys(en.legal.privacyPage).filter(
            (key) => !RENDERED_ELSEWHERE.includes(key),
        )
        expect([...PRIVACY_TEXT_SECTIONS].sort()).toEqual(sections.sort())
    })

    it('states the retention the server log prune uses', () => {
        const days = Number(
            readFileSync('backend/cmd/gripello/main.go', 'utf8').match(
                /logbuf\.Prune\(ctx, app\.DB, (\d+)\*24\*time\.Hour\)/,
            )?.[1],
        )
        expect(days).toBeGreaterThan(0)
        for (const locale of [en, de, es, fr, nl]) {
            for (const text of [
                locale.legal.privacyPage.serverLogs.body,
                locale.legal.accountDeletionPage.kept.logs,
            ]) {
                const stated = [
                    ...text.matchAll(/(\d+) (?:days|Tagen?|jours|días|dagen)/g),
                ].map((match) => Number(match[1]))
                expect(stated).toEqual([days])
            }
        }
    })
})
