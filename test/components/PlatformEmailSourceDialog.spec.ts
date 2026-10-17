import { flushPromises, mount } from '@vue/test-utils'
import EmailSourceDialog from '~/components/platform/EmailSourceDialog.vue'
import { listEmailSourceDomains } from '~/api/platform'

vi.mock('~/api/platform', () => ({
    listEmailSourceDomains: vi.fn(async () => ({
        items: ['a.test', 'b.test'],
        page: 1,
        limit: 100,
        total: 2,
    })),
}))

const source = {
    id: 'mailchecker',
    name: 'FGRibreau/mailchecker',
    homepage: 'https://github.com/FGRibreau/mailchecker',
    license: 'MIT',
    notice: 'Copyright (c) 2013 Francois-Guillaume Ribreau',
    enabled: true,
    synced_at: '2026-10-16T03:37:00Z',
    attempted_at: '2026-10-16T03:37:00Z',
    domain_count: 2,
    last_error: '',
}

function mountDialog(modelValue: boolean) {
    return mount(EmailSourceDialog, {
        props: { modelValue, source },
        global: {
            stubs: {
                LayoutDialogShell: { template: '<div><slot /></div>' },
                LayoutEmptyState: {
                    props: ['title'],
                    template: '<p>{{ title }}</p>',
                },
                UInput: true,
                UPagination: true,
            },
        },
    })
}

describe('EmailSourceDialog', () => {
    beforeEach(() => vi.mocked(listEmailSourceDomains).mockClear())

    it('loads the domains and shows the license notice when opened', async () => {
        const wrapper = mountDialog(false)
        expect(listEmailSourceDomains).not.toHaveBeenCalled()
        await wrapper.setProps({ modelValue: true })
        await flushPromises()
        expect(listEmailSourceDomains).toHaveBeenCalledWith(
            'mailchecker',
            '',
            1,
        )
        expect(
            wrapper
                .find('[data-testid="platform-email-source-domains"]')
                .text(),
        ).toContain('b.test')
        expect(
            wrapper.find('[data-testid="platform-email-source-notice"]').text(),
        ).toContain('Francois-Guillaume Ribreau')
    })
})
