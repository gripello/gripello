import { ref } from 'vue'
import { useModerationSummary } from '~/composables/useModerationSummary'
import { moderationSummary } from '~/api/moderation'

vi.mock('~/api/moderation', () => ({ moderationSummary: vi.fn() }))
vi.mock('~/api/auth', () => ({
    useAuthState: () => ({ isSignedIn: () => true }),
}))

describe('useModerationSummary', () => {
    it('drops a summary that answers for the page the staff member already left', async () => {
        const currentRoute = ref({
            path: '/platform/moderation',
            params: {} as Record<string, string>,
        })
        vi.stubGlobal('useRouter', () => ({ currentRoute }))
        vi.stubGlobal('useCurrentGymId', () => ref('g1'))
        vi.stubGlobal('usePermissions', () => ({ can: () => true }))
        vi.stubGlobal(
            'routeGymSlug',
            (params: { gym?: string }) => params.gym ?? '',
        )
        const answers: ((summary: unknown) => void)[] = []
        vi.mocked(moderationSummary).mockImplementation(
            () => new Promise((resolve) => answers.push(resolve as never)),
        )

        const moderation = useModerationSummary()
        const platform = moderation.refresh()
        currentRoute.value = { path: '/g1/manage', params: { gym: 'g1' } }
        const gym = moderation.refresh()
        answers[1]!({ open: 1 })
        await gym
        answers[0]!({ open: 9 })
        await platform

        expect(moderation.scope.value).toBe('g1')
        expect(moderation.summary.value).toEqual({ open: 1 })
    })

    it('keeps the newest count when two refreshes answer out of order', async () => {
        vi.stubGlobal('useRouter', () => ({
            currentRoute: ref({ path: '/platform/moderation', params: {} }),
        }))
        const answers: ((summary: unknown) => void)[] = []
        vi.mocked(moderationSummary).mockImplementation(
            () => new Promise((resolve) => answers.push(resolve as never)),
        )
        const moderation = useModerationSummary()
        const older = moderation.refresh()
        const newer = moderation.refresh()
        answers[1]!({ open: 2 })
        await newer
        answers[0]!({ open: 1 })
        await older
        expect(moderation.summary.value).toEqual({ open: 2 })
    })
})
