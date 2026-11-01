import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BlocklistCheck from '~/components/platform/BlocklistCheck.vue'
import {
    checkBlocklists,
    type BlocklistCheckResult,
    type Blocklists,
    type EmailSource,
} from '~/api/platform'

vi.mock('~/api/platform', () => ({ checkBlocklists: vi.fn() }))

const lists: Blocklists = {
    blocked_emails: ['spam.example'],
    allowed_emails: [],
    protected_names: ['Gripello'],
}
const sources = [{ id: 'disposable', name: 'Disposable list' }] as EmailSource[]

const emailResult = (
    rule: '' | 'allowed' | 'blocked' | 'source',
    match = '',
): BlocklistCheckResult => ({
    email: { blocked: rule === 'blocked' || rule === 'source', rule, match },
    name: null,
})

beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(checkBlocklists).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('useI18n', () => ({
        t: (key: string, params?: { match?: string }) =>
            params?.match ? `${key}:${params.match}` : key,
    }))
})

afterEach(() => {
    vi.useRealTimers()
})

function mountCheck(kind: 'email' | 'name' = 'email') {
    const wrapper = mount(BlocklistCheck, {
        props: { kind, lists, sources },
        global: {
            stubs: {
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input v-bind="$attrs" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UBadge: { template: '<span v-bind="$attrs"><slot /></span>' },
            },
        },
    })
    const verdict = () =>
        wrapper.find(`[data-testid="platform-blocklist-verdict-${kind}"]`)
    const type = async (value: string) => {
        await wrapper
            .get(`[data-testid="platform-blocklist-test-${kind}"]`)
            .setValue(value)
        await vi.advanceTimersByTimeAsync(300)
    }
    return { wrapper, verdict, type }
}

describe('PlatformBlocklistCheck', () => {
    it('checks the trimmed input against the unsaved lists once typing pauses', async () => {
        vi.mocked(checkBlocklists).mockResolvedValue(
            emailResult('source', 'disposable'),
        )
        const { wrapper, verdict } = mountCheck()
        const input = wrapper.get(
            '[data-testid="platform-blocklist-test-email"]',
        )
        await input.setValue('a@')
        await input.setValue('  a@trash.example ')
        await vi.advanceTimersByTimeAsync(299)
        expect(checkBlocklists).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)

        expect(checkBlocklists).toHaveBeenCalledOnce()
        expect(checkBlocklists).toHaveBeenCalledWith({
            ...lists,
            email: 'a@trash.example',
        })
        expect(verdict().attributes('data-blocked')).toBe('true')
        expect(verdict().text()).toBe(
            'platform.settings.blocklists.verdict.source:Disposable list',
        )
    })

    it('names the rule that decided and clears for a blank input', async () => {
        const { verdict, type } = mountCheck()
        vi.mocked(checkBlocklists).mockResolvedValue(
            emailResult('allowed', 'coach@spam.example'),
        )
        await type('coach@spam.example')
        expect(verdict().attributes('data-blocked')).toBe('false')
        expect(verdict().text()).toBe(
            'platform.settings.blocklists.verdict.exception:coach@spam.example',
        )

        vi.mocked(checkBlocklists).mockClear()
        await type('   ')
        expect(checkBlocklists).not.toHaveBeenCalled()
        expect(verdict().exists()).toBe(false)
    })

    it('trims a typed name and rechecks when the lists change', async () => {
        vi.mocked(checkBlocklists).mockResolvedValue({
            email: null,
            name: { protected: true, match: 'gripello' },
        })
        const { wrapper, verdict, type } = mountCheck('name')
        await type('  Gripello Team ')
        expect(checkBlocklists).toHaveBeenLastCalledWith({
            ...lists,
            name: 'Gripello Team',
        })
        expect(verdict().text()).toBe(
            'platform.settings.blocklists.verdict.reserved:gripello',
        )

        await wrapper.setProps({ lists: { ...lists, protected_names: [] } })
        await vi.advanceTimersByTimeAsync(300)
        expect(checkBlocklists).toHaveBeenCalledTimes(2)
        expect(checkBlocklists).toHaveBeenLastCalledWith({
            ...lists,
            protected_names: [],
            name: 'Gripello Team',
        })
    })

    it('ignores an answer that arrives after a newer check', async () => {
        let answerFirst!: (result: BlocklistCheckResult) => void
        vi.mocked(checkBlocklists)
            .mockImplementationOnce(
                () => new Promise((resolve) => (answerFirst = resolve)),
            )
            .mockResolvedValueOnce(emailResult(''))
        const { verdict, type } = mountCheck()
        await type('a@spam.example')
        await type('a@fine.example')
        answerFirst(emailResult('blocked', 'spam.example'))
        await vi.advanceTimersByTimeAsync(0)
        expect(verdict().attributes('data-blocked')).toBe('false')
        expect(verdict().text()).toBe(
            'platform.settings.blocklists.verdict.allowed',
        )
    })

    it('shows no verdict when the check fails', async () => {
        const { verdict, type } = mountCheck()
        vi.mocked(checkBlocklists).mockResolvedValueOnce(
            emailResult('blocked', 'spam.example'),
        )
        await type('a@spam.example')
        expect(verdict().exists()).toBe(true)
        vi.mocked(checkBlocklists).mockRejectedValueOnce(new Error('down'))
        await type('b@spam.example')
        expect(verdict().exists()).toBe(false)
    })
})
