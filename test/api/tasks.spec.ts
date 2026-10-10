import { beforeEach, describe, expect, it } from 'vitest'
import {
    assignTask,
    createTask,
    deleteTask,
    getTask,
    listOpenDefects,
    listRouteDefects,
    listTaskAssignees,
    listTasks,
    setTaskStatus,
    updateTask,
} from '~/api/tasks'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

describe('listTasks', () => {
    it('reads a page of the tasks of a gym', async () => {
        const page = { items: [{ id: 't1' }], page: 1, limit: 50, total: 1 }
        api.respond(page)
        expect(await listTasks('g1')).toEqual(page)
        expect(api.request().url).toBe('/api/gyms/g1/tasks')
    })

    it('sends only the set filters, statuses repeated', async () => {
        api.respond({ items: [], page: 1, limit: 30, total: 0 })
        await listTasks('g1', {
            status: ['open', 'waiting'],
            kind: null,
            assignee: 'none',
            location: 'l1',
            urgent: true,
            overdue: false,
            q: '',
            sort: '-done_at',
            limit: 30,
        })
        expect(api.request().url).toBe(
            '/api/gyms/g1/tasks?status=open&status=waiting&assignee=none&location=l1&urgent=true&sort=-done_at&limit=30',
        )
    })
})

describe('task mutations', () => {
    it('reads one task', async () => {
        api.respond({ id: 't1' })
        expect(await getTask('t1')).toEqual({ id: 't1' })
        expect(api.request().url).toBe('/api/tasks/t1')
    })

    it('creates as JSON with the captcha header', async () => {
        api.respond({ id: 't1' }, 201)
        await createTask(
            'g1',
            { kind: 'defect', route: 'r1', category: 'loose_hold' },
            null,
            { headers: { 'X-Cap-Token': 'cap' } },
        )
        const sent = api.request()
        expect(sent).toMatchObject({
            url: '/api/gyms/g1/tasks',
            method: 'POST',
            body: { kind: 'defect', route: 'r1', category: 'loose_hold' },
        })
        expect(sent.headers.get('X-Cap-Token')).toBe('cap')
    })

    it('creates as multipart with a photo', async () => {
        const photo = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
        await createTask(
            'g1',
            { kind: 'wish', grade: null, priority: 2 },
            photo,
        )
        const body = api.request().body as FormData
        expect(body.get('kind')).toBe('wish')
        expect(body.get('grade')).toBe('')
        expect(body.get('priority')).toBe('2')
        expect(body.get('photo')).toBeInstanceOf(File)
    })

    it('patches a task', async () => {
        await updateTask('t1', { title: 'Fix', assignee: '' })
        expect(api.request()).toMatchObject({
            url: '/api/tasks/t1',
            method: 'PATCH',
            body: { title: 'Fix', assignee: '' },
        })
    })

    it('assigns, unassigns and changes the status', async () => {
        await assignTask('t1', 'u1')
        expect(api.request()).toMatchObject({
            url: '/api/tasks/t1/assign',
            method: 'POST',
            body: { assignee: 'u1' },
        })
        await assignTask('t1', null)
        expect(api.request().body).toEqual({ assignee: null })
        await setTaskStatus('t1', 'done', 'Tightened')
        expect(api.request()).toMatchObject({
            url: '/api/tasks/t1/status',
            method: 'POST',
            body: { status: 'done', resolution_note: 'Tightened' },
        })
        await setTaskStatus('t1', 'open')
        expect(api.request().body).toEqual({ status: 'open' })
    })

    it('deletes a task', async () => {
        await deleteTask('t1')
        expect(api.request()).toMatchObject({
            url: '/api/tasks/t1',
            method: 'DELETE',
        })
    })
})

describe('defects and assignees', () => {
    it('lists the open defects of a gym or one of its routes', async () => {
        api.respond({ items: [{ id: 'd1' }] })
        expect(await listOpenDefects('g1')).toEqual([{ id: 'd1' }])
        expect(api.request().url).toBe('/api/gyms/g1/defects/open')
        api.respond({ items: [] })
        await listOpenDefects('g1', { route: 'r1' })
        expect(api.request().url).toBe('/api/gyms/g1/defects/open?route=r1')
    })

    it('lists the open defects of a route', async () => {
        api.respond({ items: [{ id: 'd1' }] })
        expect(await listRouteDefects('r1')).toEqual([{ id: 'd1' }])
        expect(api.request().url).toBe('/api/routes/r1/defects')
    })

    it('lists the assignees of a gym', async () => {
        api.respond({ items: [{ id: 'm1', user: 'u1', name: 'Ann' }] })
        expect(await listTaskAssignees('g1')).toEqual([
            { id: 'm1', user: 'u1', name: 'Ann' },
        ])
        expect(api.request().url).toBe('/api/gyms/g1/tasks/assignees')
    })
})
