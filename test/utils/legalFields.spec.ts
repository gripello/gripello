import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { legalFieldsFrom, legalPayload } from '~/utils/legalFields'
import {
    DEFAULT_PRIVACY_DOC,
    richTextFromPlain,
} from '#shared/utils/privacyDoc'

describe('legal fields', () => {
    it('fills missing fields with empty values', () => {
        expect(legalFieldsFrom({ legal_phone: null })).toEqual({
            legal_address: '',
            legal_phone: '',
            legal_register: '',
            legal_vat_id: '',
            legal_editorial: '',
            legal_representatives: [],
            privacy_doc: DEFAULT_PRIVACY_DOC,
        })
    })

    it('sends no privacy page while it is the default', () => {
        expect(legalPayload({}).privacy_doc).toBeNull()
        const doc = structuredClone(DEFAULT_PRIVACY_DOC)
        doc.content.push(...richTextFromPlain('Cameras at the door'))
        expect(legalPayload({ privacy_doc: doc }).privacy_doc).toEqual(doc)
    })

    it('copies the privacy page out of reactive form state', () => {
        const state = reactive(legalFieldsFrom({}))
        expect(legalFieldsFrom(state).privacy_doc).toEqual(DEFAULT_PRIVACY_DOC)
    })

    it('copies the privacy page instead of sharing it', () => {
        const fields = legalFieldsFrom({})
        fields.privacy_doc.content.pop()
        expect(legalFieldsFrom({}).privacy_doc).toEqual(DEFAULT_PRIVACY_DOC)
    })

    it('copies representatives instead of sharing them', () => {
        const people = [{ name: 'Ada' }]
        const fields = legalFieldsFrom({ legal_representatives: people })
        fields.legal_representatives[0]!.name = 'Bob'
        expect(people[0]!.name).toBe('Ada')
        expect(fields.legal_representatives[0]!.role).toBe('')
    })

    it('trims representatives and drops nameless ones', () => {
        const payload = legalPayload({
            legal_address: 'Street 1',
            legal_representatives: [
                { name: ' Ada ', role: ' CEO ' },
                { name: '  ', role: 'Ghost' },
            ],
        })
        expect(payload.legal_address).toBe('Street 1')
        expect(payload.legal_representatives).toEqual([
            { name: 'Ada', role: 'CEO' },
        ])
    })
})
