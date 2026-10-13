import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type { SearchGroup, SearchResult } from '~/composables/useGlobalSearch'

export type PaletteItem = CommandPaletteItem & { color?: string | null }

export function paletteGroups(
    pages: SearchResult[],
    remote: SearchGroup[],
    t: (key: string) => string,
    choose: (result: SearchResult) => void,
): CommandPaletteGroup<PaletteItem>[] {
    const toItem = (result: SearchResult): PaletteItem => ({
        label: result.title,
        description: result.subtitle,
        icon: result.icon,
        color: result.color,
        onSelect: () => choose(result),
    })
    return [
        {
            id: 'pages',
            label: t('nav.paletteGroupPages'),
            items: pages.map(toItem),
        },
        ...remote.map((group) => ({
            id: group.key,
            label: t(group.label),
            ignoreFilter: true,
            items: group.items.map(toItem),
        })),
    ].filter((group) => group.items.length)
}
