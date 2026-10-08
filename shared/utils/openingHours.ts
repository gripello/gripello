export const WEEKDAYS = [
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sun',
] as const
export const HOURS_DAYS = [...WEEKDAYS, 'holiday'] as const

export type Weekday = (typeof WEEKDAYS)[number]
export type HoursDay = (typeof HOURS_DAYS)[number]
export type OpeningInterval = [opens: string, closes: string]
export type GymOpeningHours = Partial<Record<HoursDay, OpeningInterval[]>>

export type OpenStatus =
    | { open: true; until: string }
    | { open: false; opensAt?: string; opensOn?: Weekday }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const SCHEMA_DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
]

// Mirrored in pocketbase/hooks/opening_hours.go.
export function isValidOpeningHours(value: unknown): value is GymOpeningHours {
    if (value === null || value === undefined) return true
    if (typeof value !== 'object' || Array.isArray(value)) return false
    return Object.entries(value).every(
        ([day, intervals]) =>
            (HOURS_DAYS as readonly string[]).includes(day) &&
            (intervals === null ||
                (Array.isArray(intervals) &&
                    intervals.every(
                        (interval) =>
                            Array.isArray(interval) &&
                            interval.length === 2 &&
                            interval.every(
                                (time) =>
                                    typeof time === 'string' && TIME.test(time),
                            ) &&
                            interval[0] !== interval[1],
                    ))),
    )
}

export function hasOpeningHours(hours: GymOpeningHours | null | undefined) {
    return HOURS_DAYS.some((day) => hours?.[day]?.length)
}

export function weekdayOf(date: Date): Weekday {
    return WEEKDAYS[(date.getDay() + 6) % 7]!
}

const minutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const crossesMidnight = ([opens, closes]: OpeningInterval) =>
    minutes(closes) < minutes(opens)

// ponytail: uses the viewer's clock; add a gym timezone once gyms span time zones.
export function openStatus(
    hours: GymOpeningHours | null | undefined,
    now: Date,
): OpenStatus {
    const index = WEEKDAYS.indexOf(weekdayOf(now))
    const time = now.getHours() * 60 + now.getMinutes()
    const today = hours?.[WEEKDAYS[index]!] ?? []
    const yesterday = hours?.[WEEKDAYS[(index + 6) % 7]!] ?? []

    const lateNight = yesterday.find(
        (i) => crossesMidnight(i) && time < minutes(i[1]),
    )
    if (lateNight) return { open: true, until: lateNight[1] }
    const current = today.find(
        (i) =>
            minutes(i[0]) <= time &&
            (crossesMidnight(i) || time < minutes(i[1])),
    )
    if (current) return { open: true, until: current[1] }

    const later = today
        .filter((i) => minutes(i[0]) > time)
        .sort((a, b) => minutes(a[0]) - minutes(b[0]))[0]
    if (later) return { open: false, opensAt: later[0] }
    for (let offset = 1; offset <= 7; offset++) {
        const day = WEEKDAYS[(index + offset) % 7]!
        const first = [...(hours?.[day] ?? [])].sort(
            (a, b) => minutes(a[0]) - minutes(b[0]),
        )[0]
        if (first) return { open: false, opensAt: first[0], opensOn: day }
    }
    return { open: false }
}

export function toSchemaOrgHours(hours: GymOpeningHours | null | undefined) {
    return WEEKDAYS.flatMap((day, index) =>
        (hours?.[day] ?? []).map(([opens, closes]) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: SCHEMA_DAYS[index],
            opens,
            closes,
        })),
    )
}
