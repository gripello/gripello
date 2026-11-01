import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, useTemplateRef } from 'vue'
import MapSheet from '~/components/map/Sheet.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)
vi.stubGlobal('nextTick', nextTick)

describe('MapSheet', () => {
    it('collapses the side panel to its toggle and reopens it', async () => {
        const wrapper = mount(MapSheet, {
            slots: {
                header: '<span data-testid="head">All routes</span>',
                default: '<ul data-testid="list" />',
            },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    UButton: {
                        props: ['ariaLabel'],
                        template:
                            '<button v-bind="$attrs" :aria-label="ariaLabel" />',
                    },
                },
            },
        })
        const toggle = () => wrapper.get('[data-testid="map-sheet-collapse"]')
        expect(wrapper.find('[data-testid="list"]').exists()).toBe(true)

        await toggle().trigger('click')
        expect(wrapper.find('[data-testid="list"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="head"]').exists()).toBe(false)
        expect(toggle().attributes('aria-label')).toBe('map.showList')

        await toggle().trigger('click')
        expect(wrapper.find('[data-testid="list"]').exists()).toBe(true)
    })
})

describe('MapSheet on phones', () => {
    let measure: () => void

    beforeEach(() => {
        vi.stubGlobal('useDisplay', () => ({ mdAndUp: ref(false) }))
        vi.stubGlobal(
            'ResizeObserver',
            class {
                elements: HTMLElement[] = []
                constructor(callback: ResizeObserverCallback) {
                    measure = () => {
                        const [container, grip] = this.elements
                        Object.defineProperty(container, 'clientHeight', {
                            value: 800,
                        })
                        Object.defineProperty(grip, 'offsetHeight', {
                            value: 64,
                        })
                        callback([], this as never)
                    }
                }
                observe(element: HTMLElement) {
                    this.elements.push(element)
                }
                disconnect() {}
            },
        )
    })

    async function mountSheet() {
        const wrapper = mount(MapSheet, {
            slots: { default: '<ul data-testid="list" />' },
            global: { mocks: { $t: (key: string) => key } },
            attachTo: document.body,
        })
        await nextTick()
        await nextTick()
        measure()
        await nextTick()
        const sheet = wrapper.get('section')
        const grip = wrapper.get('.map-sheet__grip')
        const pointer = (type: string, y: number, time: number) =>
            (type === 'pointerdown' ? grip.element : window).dispatchEvent(
                Object.defineProperty(
                    new PointerEvent(type, {
                        bubbles: true,
                        button: 0,
                        clientY: y,
                    }),
                    'timeStamp',
                    { value: time },
                ),
            )
        const drag = async (from: number, to: number, ms: number) => {
            pointer('pointerdown', from, 0)
            pointer('pointermove', (from + to) / 2, ms / 2)
            pointer('pointermove', to, ms)
            await nextTick()
            const during = sheet.attributes('style')
            pointer('pointerup', to, ms)
            await nextTick()
            return during
        }
        const handle = () => wrapper.get('[data-testid="map-sheet-handle"]')
        return { wrapper, sheet, drag, handle }
    }

    const covers = (wrapper: VueWrapper) =>
        wrapper.emitted<[number]>('cover')!.map(([height]) => height)

    it('steps through peek, half and full with the handle and reports what it covers', async () => {
        const { wrapper, sheet, handle } = await mountSheet()
        expect(sheet.attributes('style')).toContain('height: 64px')
        expect(
            wrapper.get('.map-sheet__body').attributes('inert'),
        ).toBeDefined()

        await handle().trigger('click')
        expect(wrapper.emitted('update:snap')?.at(-1)).toEqual(['half'])
        await wrapper.setProps({ snap: 'half' })
        expect(sheet.attributes('style')).toContain('height: 400px')
        expect(handle().attributes('aria-expanded')).toBe('true')
        expect(
            wrapper.get('.map-sheet__body').attributes('inert'),
        ).toBeUndefined()

        await wrapper.setProps({ snap: 'full' })
        await handle().trigger('click')
        expect(wrapper.emitted('update:snap')?.at(-1)).toEqual(['peek'])
        expect(covers(wrapper)).toEqual([64, 400, 792, 64])
    })

    it('follows a slow drag and settles on the nearest height', async () => {
        const { wrapper, sheet, drag } = await mountSheet()
        const during = await drag(700, 400, 3000)
        expect(during).toContain('height: 364px')
        expect(wrapper.emitted('update:snap')?.at(-1)).toEqual(['half'])
        expect(sheet.classes()).not.toContain('map-sheet--dragging')

        await wrapper.setProps({ snap: 'half' })
        expect(await drag(400, -2000, 30000)).toContain('height: 792px')
        expect(wrapper.emitted('update:snap')?.at(-1)).toEqual(['full'])
    })

    it('moves one step on a flick, however short', async () => {
        const { wrapper, drag } = await mountSheet()
        await wrapper.setProps({ snap: 'half' })
        await drag(400, 340, 40)
        expect(wrapper.emitted('update:snap')?.at(-1)).toEqual(['full'])
        await drag(400, 460, 40)
        expect(wrapper.emitted('update:snap')?.at(-1)).toEqual(['half'])
    })

    it('swallows the click that ends a drag but keeps taps and jitter as clicks', async () => {
        const { wrapper, drag, handle } = await mountSheet()
        await drag(700, 600, 2000)
        const snaps = wrapper.emitted('update:snap')?.length ?? 0
        await handle().trigger('click')
        expect(wrapper.emitted('update:snap')?.length ?? 0).toBe(snaps)

        await drag(700, 697, 500)
        expect(wrapper.emitted('update:snap')?.length ?? 0).toBe(snaps)
        await handle().trigger('click')
        expect(wrapper.emitted('update:snap')).toHaveLength(snaps + 1)
    })
})
