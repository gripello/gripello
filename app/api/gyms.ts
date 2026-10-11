import type {
    GymRecord,
    PermissionRecord,
    SettingsRecord,
} from '../../types/models'
import { toFormData, useApi } from './client'

export type GymFileField =
    'page_logo' | 'page_icon' | 'sign_image' | 'cover_image'

export type GymInput = Partial<Omit<GymRecord, 'id' | GymFileField>>

export type GymFiles = Partial<Record<GymFileField, File | null>>

type Items<T> = { items: T[] }

export async function getGym(slug: string): Promise<GymRecord | null> {
    if (!slug) return null
    try {
        const { redirect_to: _, ...gym } = await useApi()<
            GymRecord & { redirect_to?: string }
        >(`/gyms/${encodeURIComponent(slug)}`)
        return gym.active === false ? null : gym
    } catch {
        return null
    }
}

export function getGymById(id: string) {
    return useApi()<GymRecord>(`/gyms/${encodeURIComponent(id)}`)
}

export async function listGyms({ all = false }: { all?: boolean } = {}) {
    const { items } = await useApi()<Items<GymRecord>>('/gyms', {
        query: all ? { all: '1' } : undefined,
    })
    return items
}

export function createGym(input: GymInput & Pick<GymRecord, 'slug' | 'name'>) {
    return useApi()<GymRecord>('/gyms', { method: 'POST', body: input })
}

export function updateGym(id: string, patch: GymInput, files: GymFiles = {}) {
    return useApi()<GymRecord>(`/gyms/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: Object.values(files).some((file) => file instanceof Blob)
            ? toFormData({ ...patch, ...files })
            : { ...patch, ...files },
    })
}

export async function deleteGym(id: string) {
    await useApi()(`/gyms/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return true
}

export function getSettings() {
    return useApi()<SettingsRecord>('/settings')
}

export function updateSettings(patch: Partial<SettingsRecord>) {
    return useApi()<SettingsRecord>('/settings', {
        method: 'PATCH',
        body: patch,
    })
}

export async function listPermissions() {
    const { items } = await useApi()<Items<PermissionRecord>>('/permissions')
    return items
}
