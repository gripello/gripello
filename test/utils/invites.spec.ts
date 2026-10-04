import { describe, it, expect } from 'vitest'
import { inviteStep } from '~/utils/invites'
import type { InviteDetails } from '~/types/models'

const invite = (hasAccount: boolean): InviteDetails => ({
    email: 'New@Example.com',
    firstname: '',
    name: '',
    gym: { name: 'A', slug: 'a' },
    role: 'routesetter',
    hasAccount,
})

describe('inviteStep', () => {
    it('is invalid without an invite', () => {
        expect(inviteStep(null, '')).toBe('invalid')
        expect(inviteStep(undefined, 'new@example.com')).toBe('invalid')
    })

    it('lets the invited account join, ignoring case', () => {
        expect(inviteStep(invite(true), 'new@example.com')).toBe('join')
    })

    it('stops another signed-in account', () => {
        expect(inviteStep(invite(true), 'other@example.com')).toBe(
            'wrongAccount',
        )
    })

    it('asks guests to sign in or register', () => {
        expect(inviteStep(invite(true), '')).toBe('signIn')
        expect(inviteStep(invite(false), '')).toBe('register')
    })
})
