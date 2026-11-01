import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import TaskDefectDialog from '~/components/task/DefectDialog.vue'
import { createTask } from '~/api/tasks'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/tasks', () => ({ createTask: vi.fn() }))

let nextPhoto: File | null = null
const warning = vi.fn()
const notifyError = vi.fn()
const capHeaders = vi.fn(async (scope: string) => ({ 'X-Cap-Token': scope }))

beforeEach(() => {
    vi.mocked(createTask)
        .mockReset()
        .mockResolvedValue({} as never)
    warning.mockReset()
    notifyError.mockReset()
    capHeaders.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useCurrentGymId', () => ref('g1'))
    vi.stubGlobal('useCapToken', () => ({ capHeaders }))
    vi.stubGlobal('useNotification', () => ({
        success: vi.fn(),
        error: notifyError,
        warning,
    }))
    vi.stubGlobal('useAsyncAction', useAsyncAction)
})

function mountDialog(openDefects: { category: string }[] = []) {
    return mount(TaskDefectDialog, {
        props: { modelValue: true, routeId: 'r1', openDefects } as never,
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                OptionGrid: {
                    props: ['items'],
                    emits: ['update:modelValue'],
                    template: `<div><button v-for="item in items" :key="item.value"
                        :data-testid="'category-' + item.value"
                        @click="$emit('update:modelValue', item.value)" /></div>`,
                },
                UAlert: {
                    props: ['description'],
                    template:
                        '<p data-testid="task-defect-known">{{ description }}</p>',
                },
                UFormField: { template: '<div><slot /></div>' },
                UTextarea: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<textarea :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UFileUpload: {
                    emits: ['update:modelValue'],
                    setup: () => ({ pick: () => nextPhoto }),
                    template:
                        '<button data-testid="task-defect-photo" @click="$emit(\'update:modelValue\', pick())" />',
                },
            },
        },
    })
}

const submit = (wrapper: ReturnType<typeof mountDialog>) =>
    wrapper.find('[data-testid="task-defect-submit"]')

describe('TaskDefectDialog', () => {
    it('needs a category before it can be sent', async () => {
        const wrapper = mountDialog()
        expect(submit(wrapper).attributes('disabled')).toBeDefined()
        await wrapper
            .find('[data-testid="category-loose_hold"]')
            .trigger('click')
        expect(submit(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('files a captcha-checked defect for the route and closes', async () => {
        const wrapper = mountDialog()
        await wrapper
            .find('[data-testid="category-loose_hold"]')
            .trigger('click')
        await wrapper.find('textarea').setValue('  loose hold  ')
        await submit(wrapper).trigger('click')
        await flushPromises()

        expect(createTask).toHaveBeenCalledWith(
            'g1',
            {
                kind: 'defect',
                route: 'r1',
                category: 'loose_hold',
                description: 'loose hold',
            },
            null,
            { headers: { 'X-Cap-Token': 'task' } },
        )
        expect(wrapper.emitted('submitted')).toHaveLength(1)
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
    })

    it('refuses photos over 5 MB without sending anything', async () => {
        const wrapper = mountDialog()
        await wrapper
            .find('[data-testid="category-loose_hold"]')
            .trigger('click')
        const photo = new File(['x'], 'big.jpg', { type: 'image/jpeg' })
        Object.defineProperty(photo, 'size', { value: 5 * 1024 * 1024 + 1 })
        nextPhoto = photo
        await wrapper.find('[data-testid="task-defect-photo"]').trigger('click')
        await submit(wrapper).trigger('click')
        await flushPromises()
        expect(warning).toHaveBeenCalledWith('tasks.photoTooLarge')
        expect(createTask).not.toHaveBeenCalled()
    })

    it('stays open with the input when sending fails', async () => {
        vi.mocked(createTask).mockRejectedValue(new Error('down'))
        const wrapper = mountDialog()
        await wrapper
            .find('[data-testid="category-loose_hold"]')
            .trigger('click')
        await wrapper.find('textarea').setValue('loose hold')
        await submit(wrapper).trigger('click')
        await flushPromises()
        expect(notifyError).toHaveBeenCalled()
        expect(wrapper.emitted('submitted')).toBeUndefined()
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
        expect(
            (wrapper.find('textarea').element as HTMLTextAreaElement).value,
        ).toBe('loose hold')
    })

    it('starts empty every time it opens', async () => {
        const wrapper = mountDialog()
        await wrapper
            .find('[data-testid="category-loose_hold"]')
            .trigger('click')
        await wrapper.find('textarea').setValue('old')
        await wrapper.setProps({ modelValue: false } as never)
        await wrapper.setProps({ modelValue: true } as never)
        expect(
            (wrapper.find('textarea').element as HTMLTextAreaElement).value,
        ).toBe('')
        expect(submit(wrapper).attributes('disabled')).toBeDefined()
    })

    it('lists categories already reported once each', () => {
        const wrapper = mountDialog([
            { category: 'loose_hold' },
            { category: 'loose_hold' },
            { category: 'other' },
        ])
        expect(wrapper.find('[data-testid="task-defect-known"]').text()).toBe(
            'tasks.categories.loose_hold, tasks.categories.other',
        )
        expect(
            mountDialog().find('[data-testid="task-defect-known"]').exists(),
        ).toBe(false)
    })
})
