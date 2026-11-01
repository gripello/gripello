import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import ImportRoute from '~/components/import/Route.vue'
import { importRatings } from '~/api/ratings'
import { createRoute, listRoutes, listWalls } from '~/api/routes'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/ratings', () => ({ importRatings: vi.fn() }))
vi.mock('~/api/routes', () => ({
    createRoute: vi.fn(),
    listRoutes: vi.fn(),
    listWalls: vi.fn(),
}))

const notify = vi.fn()
const notifyError = vi.fn()
const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key

beforeEach(() => {
    notify.mockReset()
    notifyError.mockReset()
    vi.mocked(createRoute)
        .mockReset()
        .mockImplementation(
            async (_gym, input) => ({ id: `new-${input.name}` }) as never,
        )
    vi.mocked(importRatings).mockReset().mockResolvedValue({ failed: 0 })
    vi.mocked(listWalls)
        .mockReset()
        .mockResolvedValue([
            { id: 'w1', location: 'loc1', name: 'North' },
        ] as never)
    vi.mocked(listRoutes)
        .mockReset()
        .mockResolvedValue({ items: [] } as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useI18n', () => ({ t, locale: ref('en') }))
    vi.stubGlobal('useCurrentGymId', () => ref('g1'))
    vi.stubGlobal('useAuthStore', () => ({ record: { name: 'Setter Sam' } }))
    vi.stubGlobal('useNotification', () => ({ notify, error: notifyError }))
    vi.stubGlobal('useLocations', () => ({
        data: ref([{ id: 'loc1', name: 'Hall' }]),
    }))
    vi.stubGlobal('useGradeSystems', () => ({ gradeSystemFor: () => 'french' }))
})

function mountImport() {
    const wrapper = mount(ImportRoute, {
        global: {
            mocks: { $t: t },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                SegmentedControl: {
                    props: ['items'],
                    emits: ['update:modelValue'],
                    template: `<div><button v-for="item in items" :key="item.value"
                        :data-testid="'import-mode-' + item.value"
                        @click="$emit('update:modelValue', item.value)" /></div>`,
                },
                LayoutPanel: { template: '<div><slot /></div>' },
                UFormField: { template: '<div><slot /></div>' },
                USelect: {
                    props: ['modelValue', 'items'],
                    emits: ['update:modelValue'],
                    template: `<select v-bind="$attrs" :value="modelValue"
                        @change="$emit('update:modelValue', $event.target.value)">
                        <option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>`,
                },
                LayoutLoadingState: { template: '<p data-testid="loading" />' },
                LayoutEyebrow: { template: '<p v-bind="$attrs"><slot /></p>' },
                LayoutEmptyState: {
                    props: ['title'],
                    template: '<p data-testid="empty">{{ title }}</p>',
                },
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutListRow: {
                    template: '<li v-bind="$attrs"><slot /></li>',
                },
                RouteSummary: {
                    props: ['route'],
                    template: '<span>{{ route.name }}</span>',
                },
                UTable: {
                    props: ['data'],
                    template: `<div><p v-for="(row, index) in data" :key="index"
                        data-testid="import-route-row">{{ row.name }}|{{ row.grade }}|{{ row.location }}</p></div>`,
                },
                ImportRouteRatings: true,
                UCollapsible: true,
                UButton: true,
                UIcon: true,
            },
        },
    })
    const isOpen = () =>
        wrapper.findComponent(dialogShellStub).props('modelValue')
    const pick = async (name: string, content: string, type = '') => {
        const input = wrapper.get('[data-testid="import-route-file-input"]')
        Object.defineProperty(input.element, 'files', {
            value: [new File([content], name, { type })],
            configurable: true,
        })
        const errors = notifyError.mock.calls.length
        await input.trigger('change')
        await vi.waitFor(() => {
            if (!isOpen() && notifyError.mock.calls.length === errors)
                throw new Error('still reading')
        })
        await flushPromises()
    }
    const confirm = async () => {
        await wrapper
            .get('[data-testid="import-route-confirm"]')
            .trigger('click')
        await flushPromises()
    }
    const select = (field: string) =>
        wrapper.get(`[data-testid="import-route-map-${field}"]`)
    return { wrapper, pick, isOpen, confirm, select }
}

const ROUTES_JSON = JSON.stringify([
    {
        id: 'old1',
        name: 'Arete',
        grade: '6a',
        type: 'Route',
        location: 'Hall',
        wall: 'North',
        setter: 'Ann',
        ratings: [{ rating: 4, comment: 'Nice', created: '2024-03-01' }],
    },
    { id: 'old2', name: 'Crack', grade: '7a', location: 'Annex' },
])

describe('ImportRoute', () => {
    it('guesses the mapping and creates each route in its location and wall with its reviews', async () => {
        const { wrapper, pick, isOpen, confirm, select } = mountImport()
        await pick('routes.json', ROUTES_JSON)
        expect(isOpen()).toBe(true)
        expect((select('name').element as HTMLSelectElement).value).toBe('name')
        expect((select('source_id').element as HTMLSelectElement).value).toBe(
            'id',
        )
        expect((select('creator').element as HTMLSelectElement).value).toBe(
            'setter',
        )
        expect(
            wrapper
                .findAll('[data-testid="import-route-row"]')
                .map((row) => row.text()),
        ).toEqual(['Arete|6a|Hall', 'Crack|7a|Annex'])

        await confirm()
        expect(listWalls).toHaveBeenCalledWith('g1')
        expect(createRoute).toHaveBeenNthCalledWith(
            1,
            'g1',
            expect.objectContaining({
                name: 'Arete',
                grade: '6a',
                grade_system: 'french',
                type: 'Route',
                location: 'loc1',
                wall: 'w1',
                wall_position: 0.5,
                creator: ['Ann'],
            }),
        )
        expect(createRoute).toHaveBeenNthCalledWith(
            2,
            'g1',
            expect.objectContaining({
                name: 'Crack',
                location: null,
                wall: '',
                wall_position: null,
                creator: ['Setter Sam'],
            }),
        )
        expect(importRatings).toHaveBeenCalledWith('g1', [
            expect.objectContaining({
                route_id: 'new-Arete',
                rating: 4,
                comment: 'Nice',
            }),
        ])
        expect(notify).toHaveBeenCalledWith('importRoutes.success')
        expect(wrapper.emitted('closed')).toHaveLength(1)
        expect(isOpen()).toBe(false)
    })

    it('reports routes and reviews the server refused but keeps importing the rest', async () => {
        vi.mocked(createRoute).mockImplementation(async (_gym, input) => {
            if (input.name === 'Crack') throw new Error('400')
            return { id: 'new-1' } as never
        })
        vi.mocked(importRatings).mockResolvedValue({ failed: 1 })
        const { pick, confirm } = mountImport()
        await pick('routes.json', ROUTES_JSON)
        await confirm()
        expect(createRoute).toHaveBeenCalledTimes(2)
        expect(notify).toHaveBeenCalledWith(
            'importRoutes.issues(importRoutes.routesFailed(1), importRoutes.commentsFailed(1))',
            'warning',
        )
    })

    it('shows a failed import and closes when the walls cannot be loaded', async () => {
        vi.mocked(listWalls).mockRejectedValue(new Error('down'))
        const { wrapper, pick, confirm, isOpen } = mountImport()
        await pick('routes.json', ROUTES_JSON)
        await confirm()
        expect(createRoute).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith('importRoutes.failed')
        expect(wrapper.emitted('closed')).toBeUndefined()
        expect(isOpen()).toBe(false)
    })

    it('lets columns the guess missed be mapped by hand', async () => {
        const { wrapper, pick, select } = mountImport()
        await pick('routes.csv', 'Title,Level\nArete,6a\n')
        const rows = () =>
            wrapper
                .findAll('[data-testid="import-route-row"]')
                .map((row) => row.text())
        expect(rows()).toEqual(['||'])

        await select('name').setValue('Title')
        await select('grade').setValue('Level')
        expect(rows()).toEqual(['Arete|6a|'])

        await select('name').setValue('__none__')
        expect(rows()).toEqual(['|6a|'])
    })

    it('refuses unreadable or empty files without opening the preview', async () => {
        const { pick, isOpen } = mountImport()
        await pick('routes.json', '{ not json')
        await pick('routes.json', '[]')
        expect(notifyError).toHaveBeenCalledTimes(2)
        expect(notifyError).toHaveBeenCalledWith('importRoutes.invalidFile')
        expect(isOpen()).toBe(false)
    })

    it('matches reviews to routes imported earlier by their old id, lists the unmatched first and reports them', async () => {
        const { wrapper, pick, confirm } = mountImport()
        await pick('routes.json', ROUTES_JSON)
        await confirm()
        vi.mocked(importRatings).mockClear()
        vi.mocked(listRoutes).mockResolvedValue({
            items: [
                {
                    id: 'new-Arete',
                    name: 'Renamed',
                    type: 'Route',
                    expand: { location: { name: 'Hall' } },
                },
            ],
        } as never)

        await wrapper
            .get('[data-testid="import-mode-reviews"]')
            .trigger('click')
        await pick(
            'reviews.json',
            JSON.stringify([
                {
                    'route id': 'old1',
                    stars: '5',
                    text: 'Classic',
                    date: '2024-04-02',
                },
                { 'route id': 'gone', route: 'Nope', text: 'Lost' },
            ]),
        )
        expect(listRoutes).toHaveBeenCalledWith('g1', {
            archived: 'all',
            include: ['location'],
        })
        expect(wrapper.get('[data-testid="import-review-count"]').text()).toBe(
            'importRoutes.matchedCount(1,2)',
        )
        expect(
            wrapper
                .findAll('[data-testid="import-review-row"]')
                .map((row) => row.text()),
        ).toEqual([
            'importRoutes.noMatch: NopeLost',
            expect.stringContaining('RenamedClassic5/5 · '),
        ])

        await confirm()
        expect(importRatings).toHaveBeenCalledWith('g1', [
            expect.objectContaining({
                route_id: 'new-Arete',
                rating: 5,
                comment: 'Classic',
            }),
        ])
        expect(createRoute).toHaveBeenCalledTimes(2)
        expect(notify).toHaveBeenLastCalledWith(
            'importRoutes.issues(importRoutes.reviewsUnmatched(1))',
            'warning',
        )
    })

    it('cannot import reviews when no route matches or the routes failed to load', async () => {
        vi.mocked(listRoutes).mockRejectedValue(new Error('down'))
        const { wrapper, pick } = mountImport()
        await wrapper
            .get('[data-testid="import-mode-reviews"]')
            .trigger('click')
        await pick(
            'reviews.json',
            JSON.stringify([{ route: 'Nope', text: 'x' }]),
        )
        expect(wrapper.get('[data-testid="empty"]').text()).toBe(
            'importRoutes.failed',
        )
        expect(
            wrapper
                .get('[data-testid="import-route-confirm"]')
                .attributes('disabled'),
        ).toBeDefined()
    })

    it('sends reviews in chunks of 200 and counts a refused chunk as failed', async () => {
        vi.mocked(listRoutes).mockResolvedValue({
            items: [{ id: 'r1', name: 'Arete', type: 'Route' }],
        } as never)
        vi.mocked(importRatings)
            .mockResolvedValueOnce({ failed: 0 })
            .mockRejectedValueOnce(new Error('429'))
        const { wrapper, pick, confirm } = mountImport()
        await wrapper
            .get('[data-testid="import-mode-reviews"]')
            .trigger('click')
        await pick(
            'reviews.json',
            JSON.stringify(
                Array.from({ length: 203 }, (_, index) => ({
                    route: 'Arete',
                    text: `Review ${index}`,
                })),
            ),
        )
        expect(
            wrapper.findAll('[data-testid="import-review-row"]'),
        ).toHaveLength(100)
        await confirm()
        expect(
            vi
                .mocked(importRatings)
                .mock.calls.map(([, chunk]) => chunk.length),
        ).toEqual([200, 3])
        expect(notify).toHaveBeenCalledWith(
            'importRoutes.issues(importRoutes.commentsFailed(3))',
            'warning',
        )
    })
})
