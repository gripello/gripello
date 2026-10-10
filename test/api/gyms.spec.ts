import { beforeEach, describe, expect, it } from 'vitest'
import {
    createGym,
    deleteGym,
    getGym,
    getGymById,
    getSettings,
    listGyms,
    listPermissions,
    updateGym,
    updateSettings,
} from '~/api/gyms'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

describe('gyms', () => {
    it('looks a gym up by slug and drops the redirect hint', async () => {
        api.respond({ id: 'g1', slug: 'first', redirect_to: 'first' })
        expect(await getGym('erste')).toEqual({ id: 'g1', slug: 'first' })
        expect(api.request().url).toBe('/api/gyms/erste')
    })

    it('answers null for an unknown or empty slug', async () => {
        api.respond({ status: 404, message: 'Not found.', data: {} }, 404)
        expect(await getGym('nope')).toBeNull()
        expect(await getGym('')).toBeNull()
        expect(api.fetchMock).toHaveBeenCalledTimes(1)
    })

    it('answers null for an inactive gym its managers can still load', async () => {
        api.respond({ id: 'g1', slug: 'closed', active: false })
        expect(await getGym('closed')).toBeNull()
    })

    it('gets a gym by id and fails on 404', async () => {
        api.respond({ id: 'g1' })
        expect(await getGymById('g1')).toEqual({ id: 'g1' })
        expect(api.request().url).toBe('/api/gyms/g1')
        api.respond({ status: 404, message: 'Not found.', data: {} }, 404)
        await expect(getGymById('gone')).rejects.toMatchObject({ status: 404 })
    })

    it('lists active gyms, or every gym with all', async () => {
        api.respond({ items: [{ id: 'g1' }] })
        expect(await listGyms()).toEqual([{ id: 'g1' }])
        expect(api.request().url).toBe('/api/gyms')
        api.respond({ items: [] })
        await listGyms({ all: true })
        expect(api.request().url).toBe('/api/gyms?all=1')
    })

    it('creates, patches and deletes gyms as JSON', async () => {
        await createGym({ slug: 'new', name: 'New', active: true })
        expect(api.request()).toMatchObject({
            url: '/api/gyms',
            method: 'POST',
            body: { slug: 'new', name: 'New', active: true },
        })
        await updateGym('g1', { name: 'Renamed' }, { page_logo: null })
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1',
            method: 'PATCH',
            body: { name: 'Renamed', page_logo: null },
        })
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        expect(await deleteGym('g1')).toBe(true)
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1',
            method: 'DELETE',
        })
    })

    it('uploads files as multipart with the fields in @jsonPayload', async () => {
        const logo = new File(['x'], 'logo.png', { type: 'image/png' })
        await updateGym(
            'g1',
            { name: 'Gym' },
            { page_logo: logo, page_icon: null },
        )
        const body = api.request().body as FormData
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('page_logo')).toBeInstanceOf(Blob)
        expect(JSON.parse(String(body.get('@jsonPayload')))).toEqual({
            name: 'Gym',
            page_icon: null,
        })
    })
})

describe('settings and permissions', () => {
    it('reads and patches the platform settings', async () => {
        await getSettings()
        expect(api.request().url).toBe('/api/settings')
        await updateSettings({ allow_registration: false })
        expect(api.request()).toMatchObject({
            url: '/api/settings',
            method: 'PATCH',
            body: { allow_registration: false },
        })
    })

    it('lists every permission', async () => {
        api.respond({ items: [{ id: 'p1', name: 'manage_routes' }] })
        expect(await listPermissions()).toEqual([
            { id: 'p1', name: 'manage_routes' },
        ])
        expect(api.request().url).toBe('/api/permissions')
    })
})
