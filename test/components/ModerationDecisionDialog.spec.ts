import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import ModerationDecisionDialog from '~/components/moderation/DecisionDialog.vue'
import { dialogShellStub } from '../__stubs__/dialogShell'

beforeEach(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
})

function mountDialog(consequences: string[] = []) {
    return mount(ModerationDecisionDialog, {
        props: {
            modelValue: true,
            title: 'Hide review',
            confirmLabel: 'Hide',
            consequences,
        },
        global: {
            stubs: {
                LayoutDialogShell: dialogShellStub,
                OptionGrid: {
                    props: ['items'],
                    emits: ['update:modelValue'],
                    template: `<div><button v-for="item in items" :key="item.value"
                        :data-testid="'moderation-reason-' + item.value"
                        @click="$emit('update:modelValue', item.value)" /></div>`,
                },
                UFormField: { template: '<div><slot /></div>' },
                UTextarea: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<textarea v-bind="$attrs" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UButton: {
                    props: ['disabled'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

const confirm = (wrapper: ReturnType<typeof mountDialog>) =>
    wrapper.get('[data-testid="moderation-decision-confirm"]')

describe('ModerationDecisionDialog', () => {
    it('needs a reason and offers every report reason but "other"', async () => {
        const wrapper = mountDialog()
        expect(confirm(wrapper).attributes('disabled')).toBeDefined()
        expect(
            wrapper.find('[data-testid="moderation-reason-other"]').exists(),
        ).toBe(false)
        await wrapper.get('textarea').setValue('   ')
        expect(confirm(wrapper).attributes('disabled')).toBeDefined()
    })

    it('sends the preset, the explanation, or both joined', async () => {
        const wrapper = mountDialog()
        await wrapper
            .get('[data-testid="moderation-reason-harassment"]')
            .trigger('click')
        await confirm(wrapper).trigger('click')
        await wrapper.get('textarea').setValue('  insults the setter ')
        await confirm(wrapper).trigger('click')
        await wrapper.setProps({ modelValue: false })
        await wrapper.setProps({ modelValue: true })
        await wrapper.get('textarea').setValue('spam link')
        await confirm(wrapper).trigger('click')
        expect(wrapper.emitted('confirm')).toEqual([
            ['reports.reasons.harassment'],
            ['reports.reasons.harassment: insults the setter'],
            ['spam link'],
        ])
    })

    it('starts empty whenever it opens again', async () => {
        const wrapper = mountDialog()
        await wrapper.get('textarea').setValue('old reason')
        await wrapper.setProps({ modelValue: false })
        await wrapper.setProps({ modelValue: true })
        expect(
            (wrapper.get('textarea').element as HTMLTextAreaElement).value,
        ).toBe('')
        expect(confirm(wrapper).attributes('disabled')).toBeDefined()
    })

    it('lists what happens only when there are consequences', () => {
        expect(mountDialog().text()).not.toContain(
            'moderation.decision.whatHappens',
        )
        const wrapper = mountDialog(['The review is removed', 'Reports close'])
        expect(wrapper.findAll('li').map((line) => line.text())).toEqual([
            'The review is removed',
            'Reports close',
        ])
    })
})
