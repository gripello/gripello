import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ReleaseNotesDialog from '~/components/notifications/ReleaseNotesDialog.vue'

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
    LayoutLoadingState: { template: '<div />' },
    UBadge: { template: '<span class="chip"><slot /></span>' },
    UIcon: true,
    UButton: { template: '<button><slot /></button>' },
}

function createWrapper(props = {}) {
    return mount(ReleaseNotesDialog, {
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

describe('ReleaseNotesDialog', () => {
    it('never fetches — it renders only what it is given', () => {
        createWrapper({ tag: 'v1.9.0', notes: 'body' })
        expect(globalThis.$fetch).not.toHaveBeenCalled()
    })

    it('renders the tag and notes it is passed', () => {
        const wrapper = createWrapper({ tag: 'v1.9.0', notes: 'Fixed a thing' })

        expect(wrapper.text()).toContain('v1.9.0')
        expect(wrapper.text()).toContain('Fixed a thing')
    })

    it('shows a loading state while the shared check is still in flight', () => {
        const wrapper = createWrapper({
            tag: 'v1.9.0',
            notes: null,
            loading: true,
        })

        expect(
            wrapper.find('[data-testid="release-notes-loading"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="release-notes-empty"]').exists(),
        ).toBe(false)
    })

    it('reports a fetch failure as an error, not as a missing changelog', () => {
        const wrapper = createWrapper({
            tag: 'v1.9.0',
            notes: null,
            error: 'rate_limited',
        })

        expect(
            wrapper.find('[data-testid="release-notes-error"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="release-notes-empty"]').exists(),
        ).toBe(false)
        expect(wrapper.text()).toContain('notifications.releaseNotes.error')
    })

    it('shows an explicit empty state when no notes exist', () => {
        const wrapper = createWrapper({ tag: 'v1.9.0', notes: null })

        expect(
            wrapper.find('[data-testid="release-notes-empty"]').exists(),
        ).toBe(true)
        expect(wrapper.text()).toContain('notifications.releaseNotes.notFound')
    })

    it('marks the installed release only when told to', () => {
        expect(
            createWrapper({ tag: 'v1.9.0', notes: 'x', installed: true })
                .find('.chip')
                .exists(),
        ).toBe(true)
        expect(
            createWrapper({ tag: 'v1.10.0', notes: 'x' })
                .find('.chip')
                .exists(),
        ).toBe(false)
    })

    it('reacts to changed props instead of latching onto the first value', async () => {
        const wrapper = createWrapper({ tag: 'v1.9.0', notes: 'old notes' })

        await wrapper.setProps({ tag: 'v1.10.0', notes: 'new notes' })

        expect(wrapper.text()).toContain('v1.10.0')
        expect(wrapper.text()).toContain('new notes')
        expect(wrapper.text()).not.toContain('old notes')
    })

    it('renders release bullets as changes without markdown', () => {
        const wrapper = createWrapper({
            tag: 'v1.9.0',
            notes: [
                '## What changed',
                '* **Bold** item',
                '* [A link](https://example.com)',
                '* feat(ui): new thing by @tilalx in https://github.com/o/r/pull/42',
            ].join('\n'),
            repoUrl: 'https://github.com/o/r',
        })

        const text = wrapper.text()
        expect(text).toContain('Bold item')
        expect(text).toContain('A link')
        expect(text).not.toContain('**')
        const pr = wrapper.find('a[href="https://github.com/o/r/pull/42"]')
        expect(pr.exists()).toBe(true)
        expect(pr.text()).toBe('#42')
    })

    it('lists commits made since the installed release', () => {
        const wrapper = createWrapper({
            tag: 'v1.9.0',
            notes: '* feat: base',
            repoUrl: 'https://github.com/o/r',
            commits: [
                { sha: 'abc1234', message: 'fix: late fix (#50)', date: null },
            ],
        })

        expect(wrapper.text()).toContain('late fix')
        expect(
            wrapper
                .find('a[href="https://github.com/o/r/commit/abc1234"]')
                .exists(),
        ).toBe(true)
        expect(
            wrapper.find('a[href="https://github.com/o/r/pull/50"]').exists(),
        ).toBe(true)
    })
})
