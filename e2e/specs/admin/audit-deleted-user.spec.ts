import { test, expect } from '../../support/fixtures'
import type { AuditLogRecord } from '../../../types/models'
import { deleteMe, listAudit } from '../../support/api'

test('deleting an account keeps its audit trail and records the deletion', async ({
    api,
    apiAs,
    createUser,
}) => {
    const leaver = await createUser()

    const client = await apiAs(leaver)
    const loginRows = async () =>
        (
            await listAudit(api, 'platform', { action: 'login', q: leaver.id })
        ).filter((row) => row.record_id === leaver.id)
    await expect.poll(async () => (await loginRows()).length).toBe(1)

    await deleteMe(client, leaver.password)

    const rows = await loginRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.actor).toBe('')
    expect(rows[0]!.actor_label).toBe(leaver.email)

    let deleteRow: AuditLogRecord | undefined
    await expect
        .poll(async () => {
            deleteRow = (
                await listAudit(api, 'platform', {
                    action: 'delete',
                    collection: 'users',
                    q: leaver.id,
                })
            ).find((row) => row.record_id === leaver.id)
            return !!deleteRow
        })
        .toBe(true)
    expect(deleteRow!.actor).toBe('')
    expect(deleteRow!.actor_label).toBe(leaver.email)
})
