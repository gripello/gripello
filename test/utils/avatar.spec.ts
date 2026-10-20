import { avatarUrl, displayName } from '~/utils/avatar'

describe('displayName', () => {
    const user = { username: 'ada', email: 'ada@example.com' }

    it('prefers the full name, then username, then email', () => {
        expect(
            displayName({ ...user, firstname: 'Ada', name: 'Lovelace' }),
        ).toBe('Ada Lovelace')
        expect(displayName(user)).toBe('ada')
        expect(displayName({ ...user, username: '' })).toBe('ada@example.com')
    })

    it('falls back to the caller-given value', () => {
        expect(displayName(null)).toBe('')
        expect(displayName({}, '?')).toBe('?')
    })
})

describe('avatarUrl', () => {
    it('builds a thumbnail url only when an avatar exists', () => {
        expect(avatarUrl({ id: 'u1', avatar: 'a.png' })).toContain(
            '/files/users/u1/a.png?thumb=100x100',
        )
        expect(avatarUrl({ id: 'u1', avatar: 'a.png' }, '320x320')).toContain(
            'thumb=320x320',
        )
        expect(avatarUrl({ id: 'u1', avatar: null })).toBe('')
        expect(avatarUrl(null)).toBe('')
    })
})
