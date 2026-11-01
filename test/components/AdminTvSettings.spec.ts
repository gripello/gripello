import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import TvSettings from '~/components/admin/TvSettings.vue'
import { listLocations } from '~/api/routes'
import { copyText } from '~/utils/clipboard'
import { locationItems } from '~/composables/useLocations'
import {
    TV_MAX_ANNOUNCEMENTS,
    TV_MAX_SCREENS,
    TV_SLIDES,
    defaultTvScreen,
    type ResolvedTvSettings,
} from '#shared/utils/tvSettings'

vi.mock('~/api/routes', () => ({ listLocations: vi.fn() }))
vi.mock('~/utils/clipboard', () => ({ copyText: vi.fn() }))
vi.mock('~/utils/qrDataUrl', () => ({
    qrDataUrl: async (url: string) => `qr:${url}`,
}))

const success = vi.fn()
const error = vi.fn()

beforeEach(() => {
    success.mockReset()
    error.mockReset()
    vi.mocked(listLocations).mockResolvedValue([
        { id: 'hall1', name: 'Hall' },
    ] as never)
    vi.stubGlobal('locationItems', locationItems)
    vi.stubGlobal('useRequestURL', () => new URL('https://gym.example'))
    vi.stubGlobal('useNotification', () => ({ success, error }))
    vi.stubGlobal('useI18n', () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}:${Object.values(params).join(',')}` : key,
    }))
})

const field = {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input v-bind="$attrs" :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)" />`,
}

function mountSettings(settings?: Partial<ResolvedTvSettings>) {
    const model = reactive<ResolvedTvSettings>({
        screens: [defaultTvScreen()],
        announcements: [],
        ...settings,
    })
    const wrapper = mount(TvSettings, {
        props: { modelValue: model, gym: { id: 'g1', slug: 'blocs' } as never },
        global: {
            mocks: {
                $t: (key: string, params?: Record<string, unknown>) =>
                    params ? `${key}:${Object.values(params).join(',')}` : key,
            },
            stubs: {
                UFormField: { template: '<div><slot /></div>' },
                UInput: field,
                UTextarea: field,
                UButton: {
                    props: ['label', 'to'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" :data-to="to" @click="$emit(\'click\')">{{ label }}</button>',
                },
                USwitch: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input type="checkbox" v-bind="$attrs" :checked="modelValue"
                        @change="$emit('update:modelValue', $event.target.checked)" />`,
                },
                USelect: {
                    props: ['modelValue', 'items'],
                    emits: ['update:modelValue'],
                    template: `<select v-bind="$attrs" :value="modelValue"
                        @change="$emit('update:modelValue', $event.target.value)">
                        <option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>`,
                },
                UInputNumber: {
                    emits: ['update:modelValue'],
                    template: '<div v-bind="$attrs" />',
                },
                SegmentedControl: {
                    props: ['modelValue', 'items', 'testId'],
                    emits: ['update:modelValue'],
                    template: `<div :data-testid="testId" :data-value="modelValue">
                        <button v-for="item in items" :key="item.value"
                            :data-testid="item.testId ?? testId + '-' + item.value"
                            @click="$emit('update:modelValue', item.value)">{{ item.label }}</button>
                    </div>`,
                },
            },
        },
    })
    const get = (testId: string) => wrapper.get(`[data-testid="${testId}"]`)
    const has = (testId: string) =>
        wrapper.find(`[data-testid="${testId}"]`).exists()
    const url = () => get('settings-tv-url').text()
    return { wrapper, model, get, has, url }
}

describe('AdminTvSettings', () => {
    it('adds screens up to the limit, selecting each new one', async () => {
        const { model, get, has, url } = mountSettings()
        expect(url()).toBe('https://gym.example/blocs/tv?screen=main')

        await get('settings-tv-screen-add').trigger('click')
        expect(model.screens).toHaveLength(2)
        const added = model.screens[1]!
        expect(added.slides).toEqual([...TV_SLIDES])
        expect(url()).toBe(`https://gym.example/blocs/tv?screen=${added.id}`)
        expect(get('settings-tv-screen-1').text()).toBe(
            'settings.tv.screenNumber:2',
        )

        for (let i = 2; i < TV_MAX_SCREENS; i++)
            await get('settings-tv-screen-add').trigger('click')
        expect(model.screens).toHaveLength(TV_MAX_SCREENS)
        expect(has('settings-tv-screen-add')).toBe(false)
    })

    it('removes the selected screen but never the last one', async () => {
        const { model, get, has, url } = mountSettings()
        expect(has('settings-tv-screen-remove')).toBe(false)
        await get('settings-tv-screen-add').trigger('click')
        await get('settings-tv-screen-remove').trigger('click')
        expect(model.screens.map((screen) => screen.id)).toEqual(['main'])
        expect(url()).toBe('https://gym.example/blocs/tv?screen=main')
        expect(has('settings-tv-screen-remove')).toBe(false)
    })

    it('names a screen and edits only the selected one', async () => {
        const { model, get } = mountSettings({
            screens: [defaultTvScreen(), defaultTvScreen('lobby')],
        })
        await get('settings-tv-screen-1').trigger('click')
        await get('settings-tv-screen-name').setValue('Lobby')
        expect(get('settings-tv-screen-1').text()).toBe('Lobby')
        expect(model.screens[0]!.name).toBe('')

        await get('settings-tv-takeover').setValue(false)
        expect(model.screens[1]!.takeover).toBe(false)
        expect(model.screens[0]!.takeover).toBe(true)
    })

    it('toggles slides while keeping the playlist order', async () => {
        const { model, get } = mountSettings()
        await get('settings-tv-slide-new_routes').setValue(false)
        await get('settings-tv-slide-info').setValue(false)
        expect(model.screens[0]!.slides).toEqual([
            'leaderboard',
            'resets',
            'announcements',
        ])
        await get('settings-tv-slide-new_routes').setValue(true)
        expect(model.screens[0]!.slides[0]).toBe('new_routes')
    })

    it('takes preset and whole custom seconds only', async () => {
        const { wrapper, model, get } = mountSettings()
        await get('settings-tv-seconds-20').trigger('click')
        expect(model.screens[0]!.seconds).toBe(20)
        const custom = wrapper.getComponent(
            '[data-testid="settings-tv-seconds-custom"]',
        )
        custom.vm.$emit('update:modelValue', 7.5)
        custom.vm.$emit('update:modelValue', null)
        expect(model.screens[0]!.seconds).toBe(20)
        custom.vm.$emit('update:modelValue', 45)
        expect(model.screens[0]!.seconds).toBe(45)
    })

    it('narrows to a known location and treats unknown ones as all', async () => {
        const { model, get } = mountSettings({
            screens: [{ ...defaultTvScreen(), location: 'gone' }],
        })
        await flushPromises()
        const select = get('settings-tv-location')
        expect((select.element as HTMLSelectElement).value).toBe('all')

        await select.setValue('hall1')
        expect(model.screens[0]!.location).toBe('hall1')
        await select.setValue('all')
        expect(model.screens[0]!.location).toBe('')
    })

    it('adds announcements up to the limit and removes them', async () => {
        const { wrapper, model, get, has } = mountSettings()
        for (let i = 0; i < TV_MAX_ANNOUNCEMENTS; i++)
            await get('settings-tv-announcement-add').trigger('click')
        expect(model.announcements).toHaveLength(TV_MAX_ANNOUNCEMENTS)
        expect(has('settings-tv-announcement-add')).toBe(false)

        await wrapper
            .findAll('[data-testid="settings-tv-announcement-text"]')[1]!
            .setValue('Comp on Friday')
        await wrapper
            .findAll('[data-testid="settings-tv-announcement-remove"]')[0]!
            .trigger('click')
        expect(model.announcements[0]).toEqual({
            text: 'Comp on Friday',
            until: '',
        })
        expect(has('settings-tv-announcement-add')).toBe(true)
    })

    it('copies the screen link and reports a failed copy', async () => {
        const { get } = mountSettings()
        vi.mocked(copyText).mockResolvedValueOnce(true)
        await get('settings-tv-copy').trigger('click')
        await flushPromises()
        expect(copyText).toHaveBeenCalledWith(
            'https://gym.example/blocs/tv?screen=main',
        )
        expect(success).toHaveBeenCalledWith('settings.tv.copied')

        vi.mocked(copyText).mockResolvedValueOnce(false)
        await get('settings-tv-copy').trigger('click')
        await flushPromises()
        expect(error).toHaveBeenCalledWith('notifications.error.generic')
    })
})
