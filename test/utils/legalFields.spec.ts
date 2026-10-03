import { describe, expect, it } from 'vitest'
import { legalFieldsFrom, legalPayload } from '~/utils/legalFields'

describe('legal fields', () => {
    it('fills missing fields with empty values', () => {
        expect(legalFieldsFrom({ legal_phone: null })).toEqual({
            legal_address: '',
            legal_phone: '',
            legal_register: '',
            legal_vat_id: '',
            legal_editorial: '',
            legal_representatives: [],
        })
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
