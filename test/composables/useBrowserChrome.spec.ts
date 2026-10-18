import { mount } from '@vue/test-utils'
import { defineComponent, ref, watchEffect } from 'vue'
import { useBrowserChrome } from '~/composables/useBrowserChrome'

function colorSchemeMetaFor(mode: 'light' | 'dark') {
    const useHead = vi.fn()
    vi.stubGlobal('useHead', useHead)
    vi.stubGlobal('watchEffect', watchEffect)
    vi.stubGlobal('useColorMode', () => ({ value: mode }))
    vi.stubGlobal('useThemeMode', () => ({
        mode: ref('system'),
        listenForThemeChanges: () => () => {},
    }))
    mount(
        defineComponent({
            setup: () => useBrowserChrome(),
            render: () => null,
        }),
    )
    const { meta } = useHead.mock.calls[0]![0]
    return meta.find((tag: { name: string }) => tag.name === 'color-scheme')
}

describe('useBrowserChrome', () => {
    it.each(['light', 'dark'] as const)(
        'declares both themes in %s mode so forced dark modes keep the own theme',
        (mode) => {
            expect(colorSchemeMetaFor(mode).content).toBe('light dark')
        },
    )
})
