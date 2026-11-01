import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTemplateRef } from 'vue'
import BoulderBandEditor from '~/components/admin/BoulderBandEditor.vue'
import {
    MAX_BOULDER_BANDS,
    type BoulderBandSetting,
} from '#shared/utils/gradeReference'
import { gradeLabels } from '#shared/utils/grades'
import { translatedColorName } from '~/utils/colorName'
import { readableTextOn } from '~/utils/color'

const t = (key: string) => key

beforeEach(() => {
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('useI18n', () => ({ t }))
})

const YELLOW = translatedColorName(t, '#facc15')

function mountEditor(bands: BoulderBandSetting[]) {
    const wrapper = mount(BoulderBandEditor, {
        props: {
            modelValue: bands,
            'onUpdate:modelValue': (next: BoulderBandSetting[]) =>
                wrapper.setProps({ modelValue: next }),
        },
        global: {
            mocks: { $t: (key: string) => key, readableTextOn },
            stubs: {
                UFormField: { template: '<div><slot /></div>' },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input v-bind="$attrs" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UButton: {
                    props: ['disabled'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
                },
                ColorSwatchPicker: {
                    emits: ['update:modelValue'],
                    template: '<div data-testid="band-color" />',
                },
            },
        },
    })
    const bandsNow = () => wrapper.props('modelValue') as BoulderBandSetting[]
    const range = () => wrapper.get('[data-testid="boulder-band-range"]').text()
    const pick = (color: string | undefined) =>
        wrapper
            .getComponent('[data-testid="band-color"]')
            .vm.$emit('update:modelValue', color)
    return { wrapper, bandsNow, range, pick }
}

const twoBands = (): BoulderBandSetting[] => [
    { name: YELLOW, color: '#facc15', to: '5' },
    { name: 'Hard', color: '#18181b', to: '8C+' },
]

describe('AdminBoulderBandEditor', () => {
    it('shows a segment per band and the grade range of the selected one', async () => {
        const { wrapper, range } = mountEditor(twoBands())
        const segments = wrapper.findAll('[data-testid="boulder-band-segment"]')
        expect(segments.map((segment) => segment.text())).toEqual([
            YELLOW,
            'Hard',
        ])
        expect(range()).toBe('<2 – 5')
        await segments[1]!.trigger('click')
        expect(segments[1]!.attributes('aria-pressed')).toBe('true')
        expect(range()).toBe('5+ – 8C+')
    })

    it('moves a boundary with the arrow keys but never past a neighbour', async () => {
        const { wrapper, bandsNow } = mountEditor([
            { name: 'A', color: '#facc15', to: '4' },
            { name: 'B', color: '#2563eb', to: '5' },
            { name: 'C', color: '#18181b', to: '8C+' },
        ])
        const handle = () =>
            wrapper.findAll('[data-testid="boulder-band-handle"]')[0]!
        expect(handle().attributes('aria-valuetext')).toBe('4')

        await handle().trigger('keydown', { key: 'ArrowRight' })
        expect(bandsNow()[0]!.to).toBe('4+')
        await handle().trigger('keydown', { key: 'ArrowRight' })
        await handle().trigger('keydown', { key: 'ArrowRight' })
        expect(bandsNow()[0]!.to).toBe('4+')
        await handle().trigger('keydown', { key: 'ArrowLeft' })
        expect(bandsNow()[0]!.to).toBe('4')
    })

    it('splits the selected band, names the new half by its colour and selects it', async () => {
        const { wrapper, bandsNow, range } = mountEditor(twoBands())
        await wrapper.get('[data-testid="boulder-band-split"]').trigger('click')
        expect(bandsNow()).toHaveLength(3)
        expect(bandsNow()[0]!.to).toBe('3')
        expect(bandsNow()[1]).toEqual({
            name: translatedColorName(t, '#888888'),
            color: '#888888',
            to: '5',
        })
        expect(range()).toBe('4 – 5')
    })

    it('refuses to split a one-grade band or past the band limit', async () => {
        const single = mountEditor([
            { name: 'A', color: '#facc15', to: '<2' },
            { name: 'B', color: '#18181b', to: '8C+' },
        ])
        expect(
            single.wrapper
                .get('[data-testid="boulder-band-split"]')
                .attributes('disabled'),
        ).toBeDefined()

        const full = mountEditor(
            Array.from({ length: MAX_BOULDER_BANDS }, (_, index) => ({
                name: `B${index}`,
                color: '#facc15',
                to:
                    index === MAX_BOULDER_BANDS - 1
                        ? '8C+'
                        : `${['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+'][index]}`,
            })),
        )
        await full.wrapper
            .findAll('[data-testid="boulder-band-segment"]')
            .at(-1)!
            .trigger('click')
        expect(
            full.wrapper
                .get('[data-testid="boulder-band-split"]')
                .attributes('disabled'),
        ).toBeDefined()
    })

    it('keeps at least one band and moves the selection back when the last is removed', async () => {
        const { wrapper, bandsNow, range } = mountEditor(twoBands())
        await wrapper
            .findAll('[data-testid="boulder-band-segment"]')[1]!
            .trigger('click')
        await wrapper
            .get('[data-testid="boulder-band-remove"]')
            .trigger('click')
        expect(bandsNow().map((band) => band.name)).toEqual([YELLOW])
        expect(range()).toBe('<2 – 8C+')
        expect(
            wrapper
                .get('[data-testid="boulder-band-remove"]')
                .attributes('disabled'),
        ).toBeDefined()
    })

    it('renames a band named after its colour but keeps a custom name', async () => {
        const { wrapper, bandsNow, pick } = mountEditor(twoBands())
        pick('#2563eb')
        expect(bandsNow()[0]).toMatchObject({
            color: '#2563EB',
            name: translatedColorName(t, '#2563eb'),
        })
        pick(undefined)
        expect(bandsNow()[0]!.color).toBe('#2563EB')

        await wrapper
            .findAll('[data-testid="boulder-band-segment"]')[1]!
            .trigger('click')
        pick('#f00')
        expect(bandsNow()[1]).toMatchObject({ color: '#FF0000', name: 'Hard' })
    })

    it('drags a boundary to the grade under the pointer until released', async () => {
        const font = gradeLabels('font')
        const { wrapper, bandsNow } = mountEditor([
            { name: 'A', color: '#facc15', to: '4' },
            { name: 'B', color: '#2563eb', to: '6A' },
            { name: 'C', color: '#18181b', to: '8C+' },
        ])
        const bar = wrapper.get('.band-bar').element as HTMLElement
        bar.getBoundingClientRect = () =>
            ({ left: 100, width: font.length * 10 }) as DOMRect
        const handle = wrapper.findAll(
            '[data-testid="boulder-band-handle"]',
        )[1]!.element as HTMLElement
        const capture = vi.fn()
        handle.setPointerCapture = capture
        const pointer = async (type: string, grade: string) => {
            handle.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true,
                    pointerId: 7,
                    clientX: 100 + (font.indexOf(grade) + 1) * 10,
                }),
            )
            await flushPromises()
        }

        await pointer('pointerdown', '6A')
        expect(capture).toHaveBeenCalledWith(7)
        await pointer('pointermove', '6B')
        expect(bandsNow()[1]!.to).toBe('6B')
        await pointer('pointermove', '<2')
        expect(bandsNow()[1]!.to).toBe('4+')
        await pointer('pointermove', '7A')
        await pointer('pointerup', '7A')
        expect(bandsNow()[1]!.to).toBe('7A')
        expect(bandsNow()[0]!.to).toBe('4')

        await pointer('pointermove', '7C')
        expect(bandsNow()[1]!.to).toBe('7A')
    })

    it('stops following the pointer when the drag is cancelled', async () => {
        const font = gradeLabels('font')
        const { wrapper, bandsNow } = mountEditor(twoBands())
        const bar = wrapper.get('.band-bar').element as HTMLElement
        bar.getBoundingClientRect = () =>
            ({ left: 0, width: font.length * 10 }) as DOMRect
        const handle = wrapper.get('[data-testid="boulder-band-handle"]')
            .element as HTMLElement
        handle.setPointerCapture = () => {}
        const pointer = async (type: string, grade: string) => {
            handle.dispatchEvent(
                new PointerEvent(type, {
                    clientX: (font.indexOf(grade) + 1) * 10,
                }),
            )
            await flushPromises()
        }

        await pointer('pointerdown', '5')
        await pointer('pointermove', '6A')
        await pointer('pointercancel', '6A')
        await pointer('pointermove', '7A')
        expect(bandsNow()[0]!.to).toBe('6A')
    })
})
