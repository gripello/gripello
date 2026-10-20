function patternMatches(pattern: string, path: string) {
    const anchored = pattern.endsWith('$')
    const body = (anchored ? pattern.slice(0, -1) : pattern)
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')
    return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)
}

export function robotsAllows(robotsTxt: string, path: string) {
    let longestAllow = -1
    let longestDisallow = -1
    for (const line of robotsTxt.split('\n')) {
        const [field = '', ...rest] = line.split(':')
        const pattern = rest.join(':').trim()
        const directive = field.trim().toLowerCase()
        if (!pattern || !patternMatches(pattern, path)) continue
        if (directive === 'allow')
            longestAllow = Math.max(longestAllow, pattern.length)
        if (directive === 'disallow')
            longestDisallow = Math.max(longestDisallow, pattern.length)
    }
    return longestAllow >= longestDisallow
}
