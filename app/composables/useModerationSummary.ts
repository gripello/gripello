import { moderationSummary } from '~/api/moderation'
import { useAuthState } from '~/api/auth'
import type { NavBadges } from '~/utils/navigation'
import { navContext } from '~/utils/navigation'
import {
    moderationBadgeCount,
    type ModerationSummary,
} from '~/utils/moderation'

let latestRequest = 0

export function useModerationSummary() {
    const route = useRouter().currentRoute
    const gymId = useCurrentGymId()
    const { can } = usePermissions()
    const summary = useState<ModerationSummary | null>(
        'moderation-summary',
        () => null,
    )

    const scope = computed(() => {
        const context = navContext(
            route.value.path,
            routeGymSlug(route.value.params),
        )
        if (context === 'platform')
            return can('platform_admin') ? 'platform' : ''
        if (context !== 'staff' || !gymId.value) return ''
        return can('manage_comments') || can('manage_reports')
            ? gymId.value
            : ''
    })

    async function refresh() {
        if (!scope.value || !useAuthState().isSignedIn()) {
            summary.value = null
            return
        }
        const request = ++latestRequest
        const next = await moderationSummary(
            scope.value === 'platform' ? undefined : scope.value,
        ).catch(() => null)
        if (request === latestRequest) summary.value = next
    }

    const badges = computed<NavBadges>(() =>
        summary.value
            ? { moderation: moderationBadgeCount(summary.value) }
            : {},
    )

    return { summary, scope, refresh, badges }
}
