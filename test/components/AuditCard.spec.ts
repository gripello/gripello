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
                    created: '2026-10-01T10:00:00.000Z',
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

    it('labels changed fields and hides unlinked record ids', () => {
        const labels: Record<string, string> = {
            'audit.fields.latitude': 'map position',
            'audit.fields.longitude': 'map position',
        }
        vi.stubGlobal('useI18n', () => ({
            t: (key: string) => labels[key] ?? key,
            te: (key: string) => key in labels,
            locale: ref('en'),
        }))
        const wrapper = mount(AuditCard, {
            props: {
                entry: {
                    id: 'a2',
                    action: 'update',
                    collection_name: 'unknown_things',
                    record_id: 'abc123',
                    changed_fields: ['latitude', 'longitude', 'wall_position'],
                    created: '2026-10-01T10:00:00.000Z',
                } as AuditLogRecord,
            },
            global: { stubs: { UIcon: true, NuxtLink: true } },
        })

        expect(wrapper.find('[data-testid="audit-card-fields"]').text()).toBe(
            'map position, wall position',
        )
        expect(wrapper.text()).not.toContain('abc123')
    })
})
