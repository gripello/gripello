import { describe, expect, it, vi } from 'vitest'
import { paletteGroups } from '~/utils/commandPalette'

const t = (key: string) => `t:${key}`
const page = {
    key: 'page-/routes',
    to: '/routes',
    icon: 'i-lucide-list',
    title: 'Routes',
}
const route = {
    key: 'route-1',
    to: '/e2e/route?id=1',
    icon: 'i-lucide-waypoints',
    title: 'Crimp',
    subtitle: '6a · Setter',
    color: '#ff0000',
}

describe('paletteGroups', () => {
    it('puts pages first and lets the palette filter them', () => {
        const groups = paletteGroups(
            [page],
            [
                {
                    key: 'routes',
                    label: 'nav.paletteGroupRoutes',
                    items: [route],
                },
            ],
            t,
            () => {},
        )
        expect(groups.map((group) => group.id)).toEqual(['pages', 'routes'])
        expect(groups[0]).toMatchObject({ label: 't:nav.paletteGroupPages' })
        expect(groups[0]!.ignoreFilter).toBeUndefined()
        expect(groups[1]).toMatchObject({
            label: 't:nav.paletteGroupRoutes',
            ignoreFilter: true,
        })
    })

    it('drops empty groups', () => {
        const groups = paletteGroups(
            [],
            [
                { key: 'routes', label: 'nav.paletteGroupRoutes', items: [] },
                {
                    key: 'roles',
                    label: 'nav.paletteGroupRoles',
                    items: [route],
                },
            ],
            t,
            () => {},
        )
        expect(groups.map((group) => group.id)).toEqual(['roles'])
    })

    it('maps results to items that choose the result', () => {
        const choose = vi.fn()
        const [group] = paletteGroups(
            [],
            [
                {
                    key: 'routes',
                    label: 'nav.paletteGroupRoutes',
                    items: [route],
                },
            ],
            t,
            choose,
        )
        const item = group!.items![0]!
        expect(item).toMatchObject({
            label: 'Crimp',
            description: '6a · Setter',
            icon: 'i-lucide-waypoints',
            color: '#ff0000',
        })
        item.onSelect?.(new Event('select'))
        expect(choose).toHaveBeenCalledWith(route)
    })
})
