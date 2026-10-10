import type { GymRecord } from '../../types/models'
import { apiFetch } from './api-server'

const SOLE_GYM_CACHE_MS = 60_000

let soleGym: { slug: string; expires: number } | null = null

async function activeGymSlugs() {
    const { items } = await apiFetch()<{ items: GymRecord[] }>('/gyms')
    return items.map((gym) => gym.slug)
}

export async function soleActiveGymSlug(
    loadSlugs = activeGymSlugs,
    now = Date.now(),
) {
    if (soleGym && soleGym.expires > now) return soleGym.slug
    try {
        const slugs = await loadSlugs()
        const slug = slugs.length === 1 ? slugs[0]! : ''
        soleGym = { slug, expires: now + SOLE_GYM_CACHE_MS }
        return slug
    } catch {
        return ''
    }
}

export function resetSoleGymCache() {
    soleGym = null
}
