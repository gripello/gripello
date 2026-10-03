import type PocketBase from 'pocketbase'
import fs from 'node:fs'
import path from 'node:path'
import { e2eGymId } from './seed'

import { PLATFORM_SETTINGS_ID } from '../../shared/utils/platform'

const SNAPSHOT_FILE = path.join(__dirname, '..', '.auth', 'snapshot.json')

interface Snapshot {
    rateLimitsEnabled: boolean
    settings: Record<string, unknown>
    gym: Record<string, unknown>
}

async function restorableFields(
    pb: PocketBase,
    collectionName: string,
    id: string,
) {
    const collection = await pb.collections.getOne(collectionName)
    const record = await pb.collection(collectionName).getOne(id)
    return Object.fromEntries(
        collection.fields
            .filter(
                (field) =>
                    !field.system && !['file', 'autodate'].includes(field.type),
            )
            .map((field) => [field.name, record[field.name]]),
    )
}

export async function takeSnapshot(pb: PocketBase) {
    if (fs.existsSync(SNAPSHOT_FILE)) return
    const snapshot: Snapshot = {
        rateLimitsEnabled: !!(await pb.settings.getAll()).rateLimits?.enabled,
        settings: await restorableFields(pb, 'settings', PLATFORM_SETTINGS_ID),
        gym: await restorableFields(pb, 'gyms', await e2eGymId(pb)),
    }
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true })
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot))
}

export async function restoreSnapshot(pb: PocketBase) {
    if (!fs.existsSync(SNAPSHOT_FILE)) return
    const snapshot: Snapshot = JSON.parse(
        fs.readFileSync(SNAPSHOT_FILE, 'utf8'),
    )
    await pb
        .collection('settings')
        .update(PLATFORM_SETTINGS_ID, snapshot.settings)
    if (snapshot.gym) {
        await pb
            .collection('gyms')
            .update(await e2eGymId(pb), snapshot.gym)
            .catch(() => {})
    }
    await pb.settings.update({
        rateLimits: { enabled: snapshot.rateLimitsEnabled },
    })
    fs.rmSync(SNAPSHOT_FILE)
}
