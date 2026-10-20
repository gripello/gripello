export const TICK_TYPES = ['flash', 'top', 'attempt'] as const
export type TickType = (typeof TICK_TYPES)[number]

export function tickDay(date: string | null | undefined): string {
    return (date ?? '').slice(0, 10)
}

export function localDay(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function groupTicksByDay<T extends { date: string }>(
    ticks: T[],
): { day: string; ticks: T[] }[] {
    const days = new Map<string, T[]>()
    for (const tick of ticks) {
        const day = tickDay(tick.date)
        days.set(day, [...(days.get(day) ?? []), tick])
    }
    return [...days.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([day, dayTicks]) => ({ day, ticks: dayTicks }))
}
