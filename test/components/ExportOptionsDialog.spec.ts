import { flushPromises, mount } from '@vue/test-utils'
import ExportOptionsDialog from '~/components/ExportOptionsDialog.vue'

const slotStub = { template: '<div><slot /></div>' }
const dialogStub = { template: '<div><slot /><slot name="actions" /></div>' }
const buttonStub = {
    props: ['disabled', 'icon'],
    template:
        '<button :disabled="disabled" @click="$emit(\'click\')"><slot />{{ icon }}</button>',
}
const iconStub = { template: '<i><slot /></i>' }
const checkboxStub = {
    props: ['modelValue', 'value', 'label'],
    emits: ['update:modelValue'],
    template: `<input type="checkbox" :value="value" :checked="modelValue"
    @change="$emit('update:modelValue', !modelValue)" />`,
}

const selectStub = {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input data-testid="export-locale" :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)" />`,
}

function createWrapper(format: 'pdf' | 'xlsx' = 'xlsx') {
    return mount(ExportOptionsDialog, {
        props: { modelValue: true, format },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogStub,
                UFormField: slotStub,
                UIcon: iconStub,
                UButton: buttonStub,
                UCheckbox: checkboxStub,
                USelect: selectStub,
            },
        },
    })
}

type Wrapper = ReturnType<typeof createWrapper>

const confirmButton = async (wrapper: Wrapper) => {
    await wrapper.find('[data-testid="export-confirm"]').trigger('click')
    await flushPromises()
}
const confirmedColumns = (wrapper: Wrapper) =>
    (wrapper.emitted('confirm')![0] as [{ columns: string[] }])[0].columns
const checkbox = (wrapper: Wrapper, key: string) =>
    wrapper.find(`input[value="${key}"]`)

describe('ExportOptionsDialog', () => {
    beforeEach(() => localStorage.clear())

    it('confirms the table column order without the QR column', async () => {
        const wrapper = createWrapper()

        await confirmButton(wrapper)

        expect(confirmedColumns(wrapper)).toEqual([
            'color',
            'name',
            'difficulty',
            'anchor_point',
            'comment',
            'creator',
            'location',
            'wall',
            'type',
            'screw_date',
        ])
        const [payload] = wrapper.emitted('confirm')![0] as [
            { labels: Record<string, string> },
        ]
        expect(payload.labels.name).toBe('climbing.routename')
        expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([false])
    })

    it('exports the columns in the order the user moved them into', async () => {
        const wrapper = createWrapper()

        // Name above Color, then Difficulty to the bottom of the sheet.
        await wrapper
            .find('[data-testid="export-move-up-name"]')
            .trigger('click')
        for (let i = 0; i < 8; i++) {
            await wrapper
                .find('[data-testid="export-move-down-difficulty"]')
                .trigger('click')
        }
        await confirmButton(wrapper)

        expect(confirmedColumns(wrapper)).toEqual([
            'name',
            'color',
            'anchor_point',
            'comment',
            'creator',
            'location',
            'wall',
            'type',
            'screw_date',
            'difficulty',
        ])
    })

    it('confirms only the ticked columns and remembers order and selection', async () => {
        const wrapper = createWrapper()

        for (const input of wrapper.findAll('input')) {
            if (
                (input.element as HTMLInputElement).checked &&
                input.attributes('value') !== 'name'
            ) {
                await input.trigger('change')
            }
        }
        await checkbox(wrapper, 'qr').trigger('change')
        await wrapper.find('[data-testid="export-move-up-qr"]').trigger('click')
        await confirmButton(wrapper)

        // QR was moved above screw_date, so it precedes nothing else selected.
        expect(confirmedColumns(wrapper)).toEqual(['name', 'qr'])

        const restored = createWrapper()
        expect(
            restored
                .findAll('input')
                .filter((input) => (input.element as HTMLInputElement).checked)
                .map((input) => input.attributes('value')),
        ).toEqual(['name', 'qr'])
        await confirmButton(restored)
        expect(confirmedColumns(restored)).toEqual(['name', 'qr'])
    })

    it('disables the export button when nothing is selected', async () => {
        const wrapper = createWrapper()

        for (const input of wrapper.findAll('input')) {
            if ((input.element as HTMLInputElement).checked) {
                await input.trigger('change')
            }
        }

        expect(
            wrapper
                .find('[data-testid="export-confirm"]')
                .attributes('disabled'),
        ).toBeDefined()
    })

    it('confirms the pdf language and hidden fields without columns', async () => {
        const wrapper = createWrapper('pdf')

        expect(
            wrapper.find('[data-testid="export-move-up-name"]').exists(),
        ).toBe(false)
        await wrapper.find('[data-testid="export-locale"]').setValue('fr')
        await checkbox(wrapper, 'logo').trigger('change')
        await confirmButton(wrapper)

        expect(wrapper.emitted('confirm')![0]).toEqual([
            {
                locale: 'fr',
                labels: { anchor: 'climbing.anchor_point' },
                show: { creators: true, date: true, logo: false },
            },
        ])
    })
})
