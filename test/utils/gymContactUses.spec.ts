import { describe, expect, it } from 'vitest'
import type { GymContact } from '#shared/utils/gymContacts'
import {
    contactLines,
    generalContactUses,
    roleContactUses,
} from '~/utils/gymContactUses'

const general = { email: 'info@gym.example', phone: '0123' }
const keys = (uses: { key: string; fallback: boolean }[]) =>
    uses.map(({ key, fallback }) => (fallback ? `~${key}` : key))

describe('generalContactUses', () => {
    it('stands in for appeals while no privacy contact has an e-mail', () => {
        expect(keys(generalContactUses(general, []))).toEqual([
            'info',
            'imprint',
            'privacy',
            'replyTo',
            '~appeals',
        ])
        const phoneOnly: GymContact[] = [{ kind: 'privacy', phone: '1' }]
        expect(keys(generalContactUses(general, phoneOnly))).toContain(
            '~appeals',
        )
    })

    it('hands appeals to a privacy contact with an e-mail', () => {
        const contacts: GymContact[] = [
            { kind: 'privacy', email: 'dpo@gym.example' },
        ]
        expect(keys(generalContactUses(general, contacts))).toEqual([
            'info',
            'imprint',
            'privacy',
            'replyTo',
        ])
    })

    it('has no mail uses without an e-mail and no uses when empty', () => {
        expect(keys(generalContactUses({ email: '', phone: '1' }, []))).toEqual(
            ['info', 'imprint', 'privacy'],
        )
        expect(generalContactUses({ email: ' ', phone: '' }, [])).toEqual([])
    })
})

describe('roleContactUses', () => {
    const contacts: GymContact[] = [
        { kind: 'front_desk', phone: '1' },
        { kind: 'privacy', phone: '2' },
        { kind: 'privacy', email: 'dpo@gym.example' },
    ]

    it('gives the privacy page and appeals to the first fitting privacy contact', () => {
        expect(keys(roleContactUses(contacts, 0))).toEqual(['info'])
        expect(keys(roleContactUses(contacts, 1))).toEqual(['info', 'privacy'])
        expect(keys(roleContactUses(contacts, 2))).toEqual(['info', 'appeals'])
    })
})

describe('contactLines', () => {
    it('puts e-mail and phone on their own lines, or the empty text', () => {
        expect(contactLines({ email: 'a@b.c', phone: '1' })).toEqual([
            'a@b.c',
            '1',
        ])
        expect(contactLines({ email: '', phone: '' }, 'Not set')).toEqual([
            'Not set',
        ])
        expect(contactLines({ email: '', phone: '' })).toEqual([])
    })
})
