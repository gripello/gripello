import { listGymRatings } from '~/api/ratings'
import { listRoutes } from '~/api/routes'
import { listMembers, listRoles } from '~/api/members'
import { listCases } from '~/api/moderation'
import type { RouteRecord } from '~/types/models'
import { normalizeCreators } from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'
import { routeSearchQuery } from '~/utils/routeSearch'
import { moderationText } from '~/utils/moderation'

export interface SearchResult {
    key: string
    to: string
    icon: string
    title: string
    subtitle?: string
    color?: string | null
}

export interface SearchGroup {
    key: string
    label: string
    items: SearchResult[]
}

const RESULTS_PER_GROUP = 5

const SETTINGS_SECTIONS = [
    {
        section: 'branding',
        labels: [
            'settings.assets.logo',
            'settings.assets.icon',
            'settings.assets.sign',
        ],
    },
    {
        section: 'organization',
        labels: [
            'settings.organization',
            'settings.organizationName',
            'settings.organizationUnit',
            'settings.contactEmail',
        ],
    },
    {
        section: 'urls',
        labels: [
            'settings.publicUrls',
            'settings.imprintUrl',
            'settings.privacyUrl',
        ],
    },
    { section: 'legal', labels: ['settings.legalTitle'] },
]

const shorten = (text: string | null | undefined, length = 80) => {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim()
    return clean.length > length ? `${clean.slice(0, length)}…` : clean
}

export function useGlobalSearch() {
    const { t } = useI18n()
    const gymId = useCurrentGymId()
    const gymPath = useGymPath()
    const { can } = usePermissions()

    const searchRoutes = async (query: string): Promise<SearchResult[]> => {
        const search = routeSearchQuery(query)
        if (!search.q && !search.grade) return []
        const res = await listRoutes<RouteRecord>(
            gymId.value,
            { ...search, sort: 'name', page: 1, limit: 8 },
            { requestKey: null },
        )
        return res.items.map((route) => ({
            key: `route-${route.id}`,
            to: gymPath(`/route?id=${route.id}`),
            icon: 'i-lucide-waypoints',
            title: route.name,
            subtitle: [
                formatGrade(route),
                normalizeCreators(route.creator).join(', '),
            ]
                .filter(Boolean)
                .join(' · '),
            color: route.color,
        }))
    }

    const searchUsers = async (query: string): Promise<SearchResult[]> => {
        const res = await listMembers(gymId.value, {
            q: query,
            page: 1,
            limit: RESULTS_PER_GROUP,
        })
        return res.items.map(({ user }) => ({
            key: `user-${user.id}`,
            to: gymPath(
                `/admin/users?search=${encodeURIComponent(user.email ?? user.username ?? '')}`,
            ),
            icon: 'i-lucide-user',
            title:
                [user.firstname, user.name].filter(Boolean).join(' ') ||
                user.username ||
                user.email ||
                user.id,
            subtitle: user.email ?? undefined,
        }))
    }

    const searchRoles = async (query: string): Promise<SearchResult[]> => {
        const roles = await listRoles(gymId.value, {
            q: query,
            limit: RESULTS_PER_GROUP,
        })
        return roles.map((role) => ({
            key: `role-${role.id}`,
            to: gymPath('/admin/users#roles'),
            icon: 'i-lucide-shield-user',
            title: role.name,
            color: role.color,
        }))
    }

    const searchReviews = async (query: string): Promise<SearchResult[]> => {
        const res = await listGymRatings(gymId.value, {
            q: query,
            sort: 'newest',
            page: 1,
            limit: RESULTS_PER_GROUP,
        })
        return res.items.map((rating) => ({
            key: `review-${rating.id}`,
            to: gymPath(`/manage/comments?search=${encodeURIComponent(query)}`),
            icon: 'i-lucide-message-square',
            title: shorten(rating.comment) || '—',
            subtitle: (rating.expand?.route_id as RouteRecord | undefined)
                ?.name,
        }))
    }

    const searchModeration = async (query: string): Promise<SearchResult[]> => {
        const res = await listCases(
            {
                gym: gymId.value,
                q: query,
                sort: 'newest',
                page: 1,
                limit: RESULTS_PER_GROUP,
            },
            { requestKey: null },
        )
        return res.items.map((item) => ({
            key: `moderation-${item.id}`,
            to: gymPath(`/manage/moderation?case=${item.id}`),
            icon: 'i-lucide-shield-check',
            title: shorten(moderationText(item)) || '—',
            subtitle: item.context?.author?.name ?? undefined,
        }))
    }

    const searchSettings = (query: string): SearchResult[] => {
        const needle = query.toLowerCase()
        return SETTINGS_SECTIONS.flatMap((section) =>
            section.labels
                .filter((label) => t(label).toLowerCase().includes(needle))
                .map((label) => ({
                    key: `setting-${label}`,
                    to: gymPath(`/admin/settings?section=${section.section}`),
                    icon: 'i-lucide-settings',
                    title: t(label),
                    subtitle: t(section.labels[0]!),
                })),
        ).slice(0, RESULTS_PER_GROUP)
    }

    const sources = [
        {
            key: 'routes',
            label: 'nav.paletteGroupRoutes',
            search: searchRoutes,
        },
        {
            key: 'users',
            label: 'routes.users',
            permission: 'manage_users',
            search: searchUsers,
        },
        {
            key: 'roles',
            label: 'nav.paletteGroupRoles',
            permission: 'manage_users',
            search: searchRoles,
        },
        {
            key: 'reviews',
            label: 'routes.comments',
            permission: 'manage_comments',
            search: searchReviews,
        },
        {
            key: 'moderation',
            label: 'moderation.title',
            permission: 'manage_comments',
            search: searchModeration,
        },
        {
            key: 'settings',
            label: 'routes.settings',
            permission: 'manage_settings',
            search: async (query: string) => searchSettings(query),
        },
    ]

    async function search(query: string): Promise<SearchGroup[]> {
        const term = query.trim()
        if (!term) return []
        const allowed = sources.filter(
            (source) => !source.permission || can(source.permission),
        )
        return Promise.all(
            allowed.map(async (source) => ({
                key: source.key,
                label: source.label,
                items: await source.search(term).catch(() => []),
            })),
        )
    }

    return { search }
}
