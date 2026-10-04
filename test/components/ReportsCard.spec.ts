import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import ReportsCard from '~/components/reports/Card.vue'
import type { ReportRecord } from '~/types/models'

const slotStub = (tag: string) =>
    defineComponent({
        inheritAttrs: false,
        setup(_, { slots, attrs }) {
            return () =>
                h(
                    tag,
                    {
                        'data-testid': attrs['data-testid'],
                        onClick: attrs.onClick,
                    },
                    slots.default?.(),
                )
        },
    })

const report = (extra: Partial<ReportRecord> = {}) =>
    ({
        id: 'r1',
        reason: 'hate_speech',
        status: 'open',
        explanation: 'rude',
        content_snapshot: 'Gut',
        content_url: '/route?id=abc',
        notifier_name: 'Tilo',
        notifier_email: 'tilo@example.com',
        receipt_sent: true,
        created: new Date().toISOString(),
        ...extra,
    }) as ReportRecord

function createWrapper(props: { report: ReportRecord; canRemove?: boolean }) {
    return mount(ReportsCard, {
        props: { canRemove: true, ...props },
        global: {
            stubs: {
                UBadge: slotStub('span'),
                UButton: slotStub('button'),
                UIcon: true,
                UAvatar: true,
            },
        },
    })
}

describe('ReportsCard', () => {
    it('quotes the reported content and shows the reporter', () => {
        const wrapper = createWrapper({ report: report() })

        expect(wrapper.get('blockquote').text()).toBe('Gut')
        expect(wrapper.get('dl').text()).toContain('tilo@example.com')
        expect(wrapper.get('time').text()).toBe('time.justNow')
    })

    it('offers keep and remove only while open', async () => {
        const open = createWrapper({ report: report() })
        await open.get('[data-testid="report-card-remove"]').trigger('click')
        expect(open.emitted('decide')![0]![1]).toBe('content_removed')

        const done = createWrapper({
            report: report({ status: 'actioned', decision: 'content_removed' }),
        })
        expect(done.find('[data-testid="report-card-keep"]').exists()).toBe(
            false,
        )
        expect(done.text()).toContain('reports.decision.content_removed')
    })
})
