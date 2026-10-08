import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CommitListDialog from '~/components/notifications/CommitListDialog.vue'

const stubs = {
    LayoutDialogShell: {
        props: ['subtitle'],
        template:
            '<div><slot name="activator" :props="{}" /><slot name="title" />{{ subtitle }}<slot /></div>',
    },
    LayoutEmptyState: {
        props: ['title'],
        template: '<div>{{ title }}</div>',
    },
    UIcon: true,
}

function createWrapper(props = {}) {
    return mount(CommitListDialog, {
        props,
        global: {
            stubs,
            mocks: {
                $t: (key: string, params?: unknown[]) =>
                    params ? `${key}:${params.join(',')}` : key,
            },
        },
    })
}

describe('CommitListDialog', () => {
    it('lists each commit with its short sha and subject', () => {
        const wrapper = createWrapper({
            installedSha: '4f6a192',
            commits: [
                {
                    sha: 'bbbbbbb',
                    message: 'second commit',
                    date: '2026-01-02',
                },
                { sha: 'aaaaaaa', message: 'first commit', date: '2026-01-01' },
            ],
        })

        expect(wrapper.findAll('.commit-entry')).toHaveLength(2)
        expect(wrapper.text()).toContain('bbbbbbb')
        expect(wrapper.text()).toContain('second commit')
        expect(wrapper.text()).toContain('4f6a192')
    })

    it('shows the empty state when there is nothing to list', () => {
        const wrapper = createWrapper({ commits: [] })

        expect(wrapper.find('[data-testid="commit-list-empty"]').exists()).toBe(
            true,
        )
        expect(wrapper.text()).toContain('notifications.commitList.empty')
    })

    it('formats commit dates rather than printing the raw timestamp', () => {
        const wrapper = createWrapper({
            commits: [
                { sha: 'aaaaaaa', message: 'x', date: '2026-01-02T10:00:00Z' },
            ],
        })

        expect(wrapper.text()).not.toContain('2026-01-02T10:00:00Z')
        expect(wrapper.find('.commit-date').text()).not.toBe('')
    })

    it('tolerates a missing date', () => {
        const wrapper = createWrapper({
            commits: [{ sha: 'aaaaaaa', message: 'x', date: null }],
        })

        expect(wrapper.find('.commit-date').text()).toBe('')
    })
})
