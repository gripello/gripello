import { describe, expect, it } from 'vitest'
import { CLIENT_STORAGE } from '~/utils/clientStorage'
import {
    PRIVACY_RIGHTS,
    privacyBlockText,
    privacyDocProblem,
} from '~/utils/privacyEditor'
import {
    DEFAULT_PRIVACY_DOC,
    richTextFromPlain,
} from '#shared/utils/privacyDoc'

const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${JSON.stringify(params)})` : key

describe('privacy block text', () => {
    it('starts with the title and shows the section text', () => {
        expect(privacyBlockText('accounts', t, { auditDays: 30 })).toBe(
            'legal.privacyPage.accounts.title\nlegal.privacyPage.accounts.body({"auditDays":30})',
        )
    })

    it('shows the controller from the legal settings', () => {
        const controller = {
            name: 'E2E Gym',
            legal_address: 'Street 1\n12345 City',
            contact_email: 'gym@example.com',
        }
        expect(
            privacyBlockText('controller', t, { controller, auditDays: 90 }),
        ).toBe(
            'legal.privacyPage.controllerTitle\nE2E Gym\nStreet 1\n12345 City\ngym@example.com',
        )
    })

    it('lists contact details that are filled in', () => {
        const text = privacyBlockText('contact', t, {
            auditDays: 90,
            controller: {
                legal_phone: '+49 1',
                legal_representatives: [
                    { name: 'Ada', role: 'CEO' },
                    { name: '' },
                ],
            },
        })
        expect(text.split('\n')).toEqual([
            'legal.imprintPage.contact',
            'legal.imprintPage.representative',
            'Ada – CEO',
            'legal.imprintPage.phone: +49 1',
        ])
    })

    it('lists every stored item and every right', () => {
        expect(
            privacyBlockText('storage', t, { auditDays: 90 }).split('\n'),
        ).toHaveLength(2 + CLIENT_STORAGE.length)
        expect(
            privacyBlockText('rights', t, { auditDays: 90 }).split('\n'),
        ).toHaveLength(3 + PRIVACY_RIGHTS.length)
    })

    it('names what keeps the page from being saved', () => {
        const doc = structuredClone(DEFAULT_PRIVACY_DOC)
        expect(privacyDocProblem(doc, t)).toBe('')
        doc.content.push(...richTextFromPlain('x'.repeat(100001)))
        expect(privacyDocProblem(doc, t)).toBe('settings.privacy.tooLong')
        doc.content.shift()
        expect(privacyDocProblem(doc, t)).toBe('settings.privacy.required')
    })
})
