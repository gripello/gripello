import type { NavBadges } from '~/utils/navigation'
import { navContext } from '~/utils/navigation'
import {
    moderationBadgeCount,
    type ModerationSummary,
} from '~/utils/moderation'

export function useModerationSummary() {
    const pb = usePocketbase()
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
        if (!scope.value || !pb.authStore.isValid) {
            summary.value = null
            return
        }
        summary.value = await pb
            .send<ModerationSummary>('/api/moderation/summary', {
                query: scope.value === 'platform' ? {} : { gym: scope.value },
                requestKey: null,
            })
            .catch(() => null)
    }

    const badges = computed<NavBadges>(() =>
        summary.value
            ? { moderation: moderationBadgeCount(summary.value) }
            : {},
    )

    return { summary, scope, refresh, badges }
}
