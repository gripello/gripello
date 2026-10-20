import { compareSemver, type InstalledVersion } from '#shared/utils/version'

export type UpdateMode = 'release' | 'commit' | 'none'

export function decideUpdate(
    installed: InstalledVersion,
    latestTag: string | null,
    aheadBy: number,
): { mode: UpdateMode; updateAvailable: boolean } {
    if (installed.base && latestTag) {
        const comparison = compareSemver(latestTag, installed.base)
        if (comparison !== null && comparison > 0)
            return { mode: 'release', updateAvailable: true }
    }

    if (installed.sha && aheadBy > 0)
        return { mode: 'commit', updateAvailable: true }

    return { mode: 'none', updateAvailable: false }
}
