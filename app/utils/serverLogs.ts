// logfmt-style key=value text for a log record's attributes, keys sorted so rows stay comparable.
export function logAttrsText(attrs: Record<string, unknown> | undefined) {
    return Object.entries(attrs ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => {
            const text =
                typeof value === 'string' ? value : JSON.stringify(value)
            return `${key}=${/[\s"=]/.test(text) ? JSON.stringify(text) : text}`
        })
        .join(' ')
}

export function logLevelColor(level: string) {
    if (level.startsWith('ERROR')) return 'error' as const
    if (level.startsWith('WARN')) return 'warning' as const
    if (level.startsWith('DEBUG')) return 'neutral' as const
    return 'info' as const
}

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error'

interface LogLine {
    time: string
    replica?: string
    level: string
    message: string
    attrs?: Record<string, unknown>
}

const SEVERITY_RANK: Record<LogSeverity, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
}

export function logSeverity(level: string): LogSeverity {
    if (level.startsWith('ERROR')) return 'error'
    if (level.startsWith('WARN')) return 'warn'
    if (level.startsWith('DEBUG')) return 'debug'
    return 'info'
}

// The module a line comes from: an explicit `module` attribute or the "mail: …" message prefix.
export function logModule(line: LogLine) {
    const attr = line.attrs?.module
    if (typeof attr === 'string') return attr
    return /^([a-z0-9_-]+):\s/.exec(line.message)?.[1] ?? ''
}

export function filterLogs<T extends LogLine>(
    lines: T[],
    min: LogSeverity,
    query: string,
    replica = '',
) {
    const needle = query.trim().toLowerCase()
    return lines.filter(
        (line) =>
            SEVERITY_RANK[logSeverity(line.level)] >= SEVERITY_RANK[min] &&
            (!replica || line.replica === replica) &&
            (!needle ||
                `${line.message} ${logAttrsText(line.attrs)}`
                    .toLowerCase()
                    .includes(needle)),
    )
}

export function logLevelCounts(lines: LogLine[]) {
    const counts: Record<LogSeverity, number> = {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
    }
    for (const line of lines) counts[logSeverity(line.level)]++
    return counts
}

// Lines per minute for the last `minutes` minutes, oldest first.
export function logHistogram(
    lines: LogLine[],
    minutes: number,
    now = Date.now(),
) {
    const end = Math.floor(now / 60_000)
    const buckets = Array.from({ length: minutes }, () => ({
        info: 0,
        warn: 0,
        error: 0,
    }))
    for (const line of lines) {
        const index =
            minutes - 1 - (end - Math.floor(Date.parse(line.time) / 60_000))
        const bucket = buckets[index]
        if (!bucket) continue
        const severity = logSeverity(line.level)
        bucket[severity === 'debug' ? 'info' : severity]++
    }
    return buckets
}

export type ReplicaStatus = 'online' | 'offline' | 'gone'

// Every reporting server with its status, then servers known only from their log lines (stopped or forgotten).
export function logReplicas(
    lines: LogLine[],
    servers: { name: string; online: boolean }[],
) {
    const counts = new Map<string, number>()
    for (const { replica } of lines)
        if (replica) counts.set(replica, (counts.get(replica) ?? 0) + 1)
    const reporting = servers.map((server) => ({
        name: server.name,
        lines: counts.get(server.name) ?? 0,
        status: (server.online ? 'online' : 'offline') as ReplicaStatus,
    }))
    const gone = [...counts]
        .filter(([name]) => !servers.some((server) => server.name === name))
        .map(([name, lines]) => ({
            name,
            lines,
            status: 'gone' as ReplicaStatus,
        }))
        .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name))
    return [...reporting, ...gone]
}
