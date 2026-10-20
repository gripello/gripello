import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref as vueRef } from 'vue'
import { mount } from '@vue/test-utils'
import { toRouteRow, useRouteTable } from '~/composables/useRouteTable'
import type { RouteRecord } from '~/types/models'

vi.mock('@nuxt/ui/components/Button.vue', () => ({
    default: { name: 'UButton' },
}))

function setup(total = 45) {
    const load = vi.fn()
    const queryKey = vueRef('a')
    let table!: ReturnType<typeof useRouteTable>
    mount(
        defineComponent({
            setup() {
                table = useRouteTable({
                    itemsPerPage: 20,
                    totalItems: vueRef(total),
                    queryKey,
                    defaultSort: '-created',
                    load,
                })
                return () => h('div')
            },
        }),
    )
    return { table, load, queryKey }
}

describe('useRouteTable', () => {
    it('cycles a column through ascending, descending and unsorted', () => {
        const { table, load } = setup()
        const header = (key: string) =>
            table.sortableHeader(key, key)() as unknown as {
                props: { onClick: () => void; trailingIcon: string }
            }

        expect(
            (table.sortableHeader('name', 'name')() as { type: object }).type,
        ).toMatchObject({ name: 'UButton' })
        expect(header('screw_date').props.trailingIcon).toBe(
            'i-lucide-arrow-down',
        )
        header('name').props.onClick()
        expect(load).toHaveBeenLastCalledWith({
            page: 1,
            sortBy: [{ key: 'name', order: 'asc' }],
        })
        table.tableOptions.sortBy = [{ key: 'name', order: 'asc' }]
        header('name').props.onClick()
        expect(load).toHaveBeenLastCalledWith({
            page: 1,
            sortBy: [{ key: 'name', order: 'desc' }],
        })
        table.tableOptions.sortBy = [{ key: 'name', order: 'desc' }]
        header('name').props.onClick()
        expect(load).toHaveBeenLastCalledWith({ page: 1, sortBy: [] })
    })

    it('maps sort keys to API fields and falls back to the default', () => {
        const { table } = setup()
        expect(table.routeSort()).toBe('-screw_date')
        table.tableOptions.sortBy = [{ key: 'score', order: 'desc' }]
        expect(table.routeSort()).toBe('-average_rating')
        table.tableOptions.sortBy = [{ key: 'difficulty', order: 'asc' }]
        expect(table.routeSort()).toBe('type,grade_index')
        table.tableOptions.sortBy = []
        expect(table.routeSort()).toBe('-created')
    })

    it('shows the visible range and reloads page 1 after the query settles', async () => {
        vi.useFakeTimers()
        const { table, load, queryKey } = setup()
        table.tableOptions.page = 3
        expect(table.pageInfo.value).toBe('41-45 / 45')

        queryKey.value = 'b'
        await nextTick()
        queryKey.value = 'c'
        await nextTick()
        vi.advanceTimersByTime(299)
        expect(load).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(load).toHaveBeenCalledExactlyOnceWith({ page: 1 })
        vi.useRealTimers()
    })
})

describe('toRouteRow', () => {
    it('scores only rated routes and normalises creators and comments', () => {
        const base = { id: 'r1', creator: 'Ann, Bob' } as unknown as RouteRecord
        expect(toRouteRow(base)).toMatchObject({
            comment: '',
            creator: ['Ann', 'Bob'],
            score: null,
            has_ratings: false,
        })
        expect(
            toRouteRow({ ...base, ratings_count: 2, average_rating: 4.5 }),
        ).toMatchObject({ score: 4.5, has_ratings: true })
    })
})
