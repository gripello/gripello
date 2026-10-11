export interface SortOption {
    key: string
    order?: 'asc' | 'desc'
}

export function toSortParam(
    sortByArr: SortOption[],
    defaultSort = '-created',
    keyMap: Record<string, string> = {},
): string {
    if (!Array.isArray(sortByArr) || !sortByArr.length) {
        return defaultSort
    }
    return sortByArr
        .map((sort) => {
            const fields = (keyMap[sort.key] ?? sort.key).split(',')
            const key = fields.pop()!
            return [...fields, sort.order === 'desc' ? `-${key}` : key].join(
                ',',
            )
        })
        .join(',')
}
