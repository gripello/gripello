import { readFileSync } from 'node:fs'
import { mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref, useTemplateRef, watch } from 'vue'
import ColorSwatchPicker from '~/components/color/SwatchPicker.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('useTemplateRef', useTemplateRef)
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))

const stubs = {
    UPopover: { template: '<div><slot /><slot name="content" /></div>' },
    UColorPicker: true,
    UInput: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template:
            '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UIcon: true,
}

function mountPicker(
    modelValue: string,
    swatches: string[] = ['#F44336', '#2196f3'],
) {
    const picker: VueWrapper = mount(ColorSwatchPicker, {
        props: {
            modelValue,
            label: 'Colour',
            swatches,
            testIdPrefix: 'role-form',
            'onUpdate:modelValue': (value: string) =>
                picker.setProps({ modelValue: value }),
        },
        global: { stubs },
        attachTo: document.body,
    })
    return picker
}

describe('ColorSwatchPicker', () => {
    it('names each swatch by colour, not only by hex', () => {
        const swatch = mountPicker('').get(
            '[data-testid="role-form-swatch-F44336"]',
        )
        expect(swatch.attributes('aria-label')).toBe('colors.red, #F44336')
    })

    it('checks the matching swatch regardless of hex case', () => {
        const picker = mountPicker('#2196F3')
        expect(
            picker
                .get('[data-testid="role-form-swatch-2196F3"]')
                .attributes('aria-checked'),
        ).toBe('true')
        expect(
            picker.get('[data-testid="role-form-color-custom"]').classes(),
        ).not.toContain('color-swatch--active')
    })

    it('marks an off-palette colour as custom and emits picks', async () => {
        const picker = mountPicker('#123456')
        expect(
            picker.get('[data-testid="role-form-color-custom"]').classes(),
        ).toContain('color-swatch--active')
        await picker
            .get('[data-testid="role-form-swatch-F44336"]')
            .trigger('click')
        expect(picker.emitted('update:modelValue')?.[0]).toEqual(['#F44336'])
    })

    it('grows swatches to a 44px touch target on coarse pointers', () => {
        const source = readFileSync(
            'app/components/color/SwatchPicker.vue',
            'utf8',
        )
        expect(source).toMatch(
            /@media \(pointer: coarse\) \{\s*\.color-swatch \{\s*width: 44px;\s*height: 44px;/,
        )
    })

    it('is a radiogroup with one tab stop that arrow keys move', async () => {
        const picker = mountPicker('#F44336')
        expect(picker.attributes('role')).toBe('radiogroup')
        expect(picker.attributes('aria-label')).toBe('Colour')
        const red = picker.get('[data-testid="role-form-swatch-F44336"]')
        const blue = picker.get('[data-testid="role-form-swatch-2196F3"]')
        const custom = picker.get('[data-testid="role-form-color-custom"]')
        expect(
            [red, blue, custom].map((el) => el.attributes('tabindex')),
        ).toEqual(['0', '-1', '-1'])
        await red.trigger('keydown', { key: 'ArrowRight' })
        expect(picker.emitted('update:modelValue')?.at(-1)).toEqual(['#2196f3'])
        expect(document.activeElement).toBe(blue.element)
        await blue.trigger('keydown', { key: 'ArrowRight' })
        expect(document.activeElement).toBe(custom.element)
        expect(picker.emitted('update:modelValue')).toHaveLength(1)
        picker.unmount()
    })

    it('checks the custom radio and names its colour', () => {
        const custom = mountPicker('#123456').get(
            '[data-testid="role-form-color-custom"]',
        )
        expect(custom.attributes('role')).toBe('radio')
        expect(custom.attributes('aria-checked')).toBe('true')
        expect(custom.attributes('tabindex')).toBe('0')
        expect(custom.attributes('aria-label')).toBe(
            'climbing.customColor, #123456',
        )
    })

    it('is a plain button without swatches', () => {
        const picker = mountPicker('', [])
        expect(picker.attributes('role')).toBeUndefined()
        const custom = picker.get('[data-testid="role-form-color-custom"]')
        expect(custom.attributes('role')).toBeUndefined()
        expect(custom.attributes('aria-checked')).toBeUndefined()
        expect(custom.attributes('tabindex')).toBe('0')
    })

    it('emits typed hex only once it is a valid colour', async () => {
        const picker = mountPicker('#F44336')
        const input = picker.get('[data-testid="role-form-color-hex"]')
        await input.setValue('#12')
        expect(picker.emitted('update:modelValue')).toBeUndefined()
        expect(input.attributes('aria-invalid')).toBe('true')
        await input.setValue('123')
        expect(picker.emitted('update:modelValue')?.at(-1)).toEqual(['#123'])
        await input.setValue('')
        expect(picker.emitted('update:modelValue')?.at(-1)).toEqual([''])
    })
})
