import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import de from '../../i18n/locales/de.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import nl from '../../i18n/locales/nl.json'

describe('platform insights', () => {
    it('labels every feature the server counts', () => {
        const features = new Set(
            [
                ...readFileSync(
                    'backend/internal/platform/metrics/usage.go',
                    'utf8',
                ).matchAll(/"[A-Z]+ \/api\/[^"]+":\s+"([^"]+)"/g),
            ].map((match) => match[1]!),
        )
        expect(features.size).toBeGreaterThan(30)
        for (const locale of [en, de, es, fr, nl]) {
            for (const feature of features) {
                const label = feature
                    .split('.')
                    .reduce<unknown>(
                        (node, key) => (node as Record<string, unknown>)?.[key],
                        locale.platform.insights.names,
                    )
                expect(typeof label, feature).toBe('string')
            }
        }
    })
})
