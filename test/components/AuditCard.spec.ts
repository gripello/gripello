import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AuditCard from '~/components/audit/Card.vue'
import type { AuditLogRecord } from '~/types/models'

describe('AuditCard', () => {
    it('shows the absolute time as text where there is no hover', () => {
        vi.stubGlobal('useI18n', () => ({
            t: (key: string) => key,
            te: () => false,
            locale: ref('en'),
        }))
        const wrapper = mount(AuditCard, {
            props: {
                entry: {
                    id: 'a1',
                    action: 'create',
                    created: '2026-10-01 10:00:00.000Z',
                } as AuditLogRecord,
            },
            global: { stubs: { UIcon: true, NuxtLink: true } },
        })
        const absolute = wrapper.find(
            '[data-testid="audit-card-absolute-time"]',
        )

        expect(absolute.classes()).toContain('pointer-fine:hidden')
        expect(absolute.text()).toBe(
            wrapper.find('[data-testid="audit-card-time"]').attributes('title'),
        )
        expect(absolute.text()).toContain('2026')
    })
})
