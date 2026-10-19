import { flushPromises, mount } from '@vue/test-utils'
import IssueList from '~/components/platform/IssueList.vue'
import { listIssueOccurrences } from '~/api/platform'

vi.mock('~/api/platform', () => ({
    listIssues: vi.fn(async () => ({
        items: ['a', 'b'].map((fingerprint) => ({
            fingerprint,
            level: 'ERROR',
            message: fingerprint,
            count: 1,
            users: 0,
            first_seen: '2026-01-01T00:00:00Z',
            last_seen: '2026-01-01T00:00:00Z',
        })),
    })),
    listIssueOccurrences: vi.fn(),
}))

describe('PlatformIssueList', () => {
    it('shows the occurrences of the issue opened last, not of a slower earlier one', async () => {
        vi.stubGlobal('useRoute', () => ({ query: {} }))
        const answers: Record<string, (message: string) => void> = {}
        vi.mocked(listIssueOccurrences).mockImplementation(
            (fingerprint: string) =>
                new Promise((resolve) => {
                    answers[fingerprint] = (message) =>
                        resolve({
                            items: [
                                {
                                    time: '2026-01-01T00:00:00Z',
                                    replica: 'r1',
                                    level: 'ERROR',
                                    message,
                                },
                            ],
                        } as never)
                }),
        )
        const wrapper = mount(IssueList, {
            global: {
                stubs: {
                    LayoutPanel: { template: '<div><slot /></div>' },
                    SegmentedControl: true,
                },
            },
        })
        await flushPromises()
        await wrapper
            .find('[data-testid="platform-issue-a"] button')
            .trigger('click')
        await wrapper
            .find('[data-testid="platform-issue-b"] button')
            .trigger('click')
        answers.b!('occurrence of b')
        await flushPromises()
        answers.a!('occurrence of a')
        await flushPromises()
        const shown = wrapper.find('[data-testid="platform-issue-b"]').text()
        expect(shown).toContain('occurrence of b')
        expect(shown).not.toContain('occurrence of a')
    })
})
