import { userEventAction } from '~/utils/userEvents'

describe('userEventAction', () => {
    it('signs out on deletion', () => {
        expect(userEventAction({ kind: 'user.deleted' })).toEqual({
            kind: 'clear',
        })
    })

    it('adopts the record of an update', () => {
        const record = { id: 'u1' }
        expect(userEventAction({ kind: 'user.updated', record })).toEqual({
            kind: 'save',
            record,
        })
    })

    it('ignores other kinds and updates without a record', () => {
        expect(userEventAction({ kind: 'account.changed' })).toEqual({
            kind: 'ignore',
        })
        expect(userEventAction({ kind: 'user.updated' })).toEqual({
            kind: 'ignore',
        })
    })
})
