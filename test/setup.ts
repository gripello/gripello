import { beforeEach, vi } from 'vitest'
import {
    ref as vueRef,
    shallowRef as vueShallowRef,
    computed as vueComputed,
    onMounted as vueOnMounted,
    onBeforeUnmount as vueOnBeforeUnmount,
    onActivated as vueOnActivated,
    onDeactivated as vueOnDeactivated,
    watch as vueWatch,
    useId as vueUseId,
} from 'vue'
import { config } from '@vue/test-utils'
import { useVersionCheck } from '~/composables/useVersionCheck'
import LayoutDialogShell from '~/components/layout/DialogShell.vue'
import LayoutPageHeader from '~/components/layout/PageHeader.vue'
import LayoutEmptyState from '~/components/layout/EmptyState.vue'
import LayoutLoadingState from '~/components/layout/LoadingState.vue'

type VitestMock = ReturnType<typeof vi.fn>
type RuntimeConfig = { public?: Record<string, unknown> }

declare global {
    namespace NodeJS {
        interface Process {
            server?: boolean
        }
    }
    var __POCKETBASE_CLIENT__: unknown | undefined
    var __NUXT_RUNTIME_CONFIG__: Record<string, unknown> | undefined
    var $fetch: VitestMock
    var useRuntimeConfig: () => RuntimeConfig
    var usePocketbase: () => unknown
    var useI18n: () => {
        t: (key: string) => string
        locale: { value: string }
        loadLocaleMessages: (locale: string) => Promise<void>
    }
    var useNuxtApp: () => {
        $i18n: { t: (key: string) => string }
    }
    var useAsyncData: <T>(
        key: string,
        handler: () => Promise<T>,
        options?: { default?: () => T },
    ) => {
        data: { value: T | null }
        error: { value: unknown }
        pending: { value: boolean }
        status: { value: string }
        refresh: () => Promise<void>
        execute: () => Promise<void>
    }
    var ref: typeof vueRef
    var computed: typeof vueComputed
    var onMounted: typeof vueOnMounted
    var onBeforeUnmount: typeof vueOnBeforeUnmount
    var onActivated: typeof vueOnActivated
    var onDeactivated: typeof vueOnDeactivated
    var watch: typeof vueWatch
    var useState: <T>(key: string, init?: () => T) => { value: T }
}

const defaultRuntimeConfig = {
    public: {
        appVersion: '0.0.0',
    },
}

const runtimeConfigGetter = () =>
    (globalThis.__NUXT_RUNTIME_CONFIG__ as RuntimeConfig) ??
    defaultRuntimeConfig
const pocketbaseGetter = () => {
    if (!globalThis.__POCKETBASE_CLIENT__) {
        throw new Error('PocketBase mock not configured')
    }
    return globalThis.__POCKETBASE_CLIENT__
}
const i18nGetter = () => ({
    t: (key: string) => key,
    locale: vueRef('en'),
    loadLocaleMessages: async () => {},
})

const nuxtAppMock = { $i18n: { t: (key: string) => key } }
const nuxtAppGetter = () => nuxtAppMock

const useAsyncDataGetter = <T>(
    _key: string,
    handler: () => Promise<T>,
    options?: { default?: () => T },
) => {
    const data = vueRef<T | null>(options?.default ? options.default() : null)
    const error = vueRef<unknown>(null)
    const pending = vueRef(true)
    const status = vueRef<'pending' | 'success' | 'error'>('pending')

    const run = async () => {
        pending.value = true
        status.value = 'pending'
        try {
            data.value = await handler()
            error.value = null
            status.value = 'success'
        } catch (caught) {
            error.value = caught
            status.value = 'error'
        } finally {
            pending.value = false
        }
    }

    void run()
    return { data, error, pending, status, refresh: run, execute: run }
}

const useStateMocks: Record<string, { value: unknown }> = {}
const useStateGetter = <T>(key: string, init?: () => T) => {
    if (!useStateMocks[key]) {
        useStateMocks[key] = vueRef(init ? init() : undefined)
    }
    return useStateMocks[key] as { value: T }
}

vi.stubGlobal('useRuntimeConfig', runtimeConfigGetter)
vi.stubGlobal('usePocketbase', pocketbaseGetter)
vi.stubGlobal('useI18n', i18nGetter)
vi.stubGlobal('useNuxtApp', nuxtAppGetter)
vi.stubGlobal('useState', useStateGetter)
vi.stubGlobal('useAsyncData', useAsyncDataGetter)
vi.stubGlobal('useVersionCheck', useVersionCheck)
vi.stubGlobal('useId', vueUseId)
vi.stubGlobal('shallowRef', vueShallowRef)
vi.stubGlobal('useDisplay', () => ({
    smAndDown: vueComputed(() => false),
    smAndUp: vueComputed(() => true),
    mdAndUp: vueComputed(() => true),
    mobile: vueComputed(() => false),
}))
if (!('ref' in globalThis)) {
    vi.stubGlobal('ref', vueRef)
} else {
    globalThis.ref = vueRef
}
if (!('computed' in globalThis)) {
    vi.stubGlobal('computed', vueComputed)
} else {
    globalThis.computed = vueComputed
}
if (!('onMounted' in globalThis)) {
    vi.stubGlobal('onMounted', vueOnMounted)
} else {
    globalThis.onMounted = vueOnMounted
}
if (!('onBeforeUnmount' in globalThis)) {
    vi.stubGlobal('onBeforeUnmount', vueOnBeforeUnmount)
} else {
    globalThis.onBeforeUnmount = vueOnBeforeUnmount
}
if (!('onActivated' in globalThis)) {
    vi.stubGlobal('onActivated', vueOnActivated)
    vi.stubGlobal('onDeactivated', vueOnDeactivated)
} else {
    globalThis.onActivated = vueOnActivated
    globalThis.onDeactivated = vueOnDeactivated
}
if (!('watch' in globalThis)) {
    vi.stubGlobal('watch', vueWatch)
} else {
    globalThis.watch = vueWatch
}

beforeEach(() => {
    process.server = false
    delete (globalThis as Record<string, unknown>)._pb
    globalThis.__POCKETBASE_CLIENT__ = undefined
    globalThis.__NUXT_RUNTIME_CONFIG__ = undefined
    for (const key of Object.keys(useStateMocks)) {
        delete useStateMocks[key]
    }
    if (!('$fetch' in globalThis)) {
        vi.stubGlobal('$fetch', vi.fn())
    } else {
        globalThis.$fetch.mockReset()
    }
})

config.global.components = {
    ...(config.global.components ?? {}),
    LayoutDialogShell,
    LayoutPageHeader,
    LayoutEmptyState,
    LayoutLoadingState,
}
