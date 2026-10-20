import { mount } from '@vue/test-utils'
import PrivacyDoc from '~/components/legal/PrivacyDoc.vue'

describe('LegalPrivacyDoc', () => {
    it('links every titled section from a contents list', () => {
        const wrapper = mount(PrivacyDoc, {
            props: {
                controller: null,
                imprintPath: '/imprint',
                auditRetentionDays: 90,
            },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    LegalRichText: true,
                    LegalContactDetails: true,
                    NuxtLink: { template: '<a><slot /></a>' },
                },
            },
        })
        const links = wrapper
            .findAll('[data-testid="privacy-toc"] a')
            .map((link) => link.attributes('href')!.slice(1))
        expect(links.length).toBeGreaterThan(1)
        for (const id of links)
            expect(wrapper.find(`#${id}`).exists()).toBe(true)
    })
})
