import { describe, expect, it } from 'vitest'
import {
    adminUsersTabFromHash,
    adminUsersTabHash,
    withSelectedRole,
} from '~/utils/adminUsersTab'

describe('adminUsersTab', () => {
    it('opens the roles tab for #roles', () => {
        expect(adminUsersTabFromHash('#roles')).toBe('roles')
    })

    it('falls back to members for any other hash', () => {
        expect(adminUsersTabFromHash('')).toBe('members')
        expect(adminUsersTabFromHash('#members')).toBe('members')
        expect(adminUsersTabFromHash('#other')).toBe('members')
    })

    it('round-trips the tab through the hash', () => {
        expect(adminUsersTabFromHash(adminUsersTabHash('roles'))).toBe('roles')
        expect(adminUsersTabHash('members')).toBe('')
    })

    it('sets the selected role and keeps other query params', () => {
        expect(withSelectedRole({ search: 'ada', role: 'r1' }, 'r2')).toEqual({
            search: 'ada',
            role: 'r2',
        })
    })

    it('drops the role param when nothing is selected', () => {
        expect(withSelectedRole({ search: 'ada', role: 'r1' }, null)).toEqual({
            search: 'ada',
        })
    })
})
