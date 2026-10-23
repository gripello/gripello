import { ref } from 'vue'

type TransitionHook = (transition: ViewTransition) => void

function fakeTransition() {
    let finishUpdate!: () => void
    const updateCallbackDone = new Promise<void>((resolve) => {
        finishUpdate = resolve
    })
    const transition = {
        updateCallbackDone,
        finished: updateCallbackDone,
        skipTransition: vi.fn(),
    } as unknown as ViewTransition
    return { transition, finishUpdate }
}

async function startPlugin() {
    let onStart!: TransitionHook
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)
    vi.stubGlobal('useForcedPop', () => ref(false))
    vi.stubGlobal('useRouter', () => ({
        beforeEach: vi.fn(),
        afterEach: vi.fn(),
    }))
    const { default: plugin } = await import('~/plugins/nav-direction.client')
    ;(plugin as unknown as (app: unknown) => void)({
        hook: (name: string, hook: TransitionHook) => {
            if (name === 'page:view-transition:start') onStart = hook
        },
    })
    return { onStart }
}

describe('nav direction plugin', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('skips the slide of a page that is still loading, so the screen does not freeze', async () => {
        const { onStart } = await startPlugin()
        const { transition } = fakeTransition()

        onStart(transition)
        await vi.advanceTimersByTimeAsync(149)
        expect(transition.skipTransition).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(transition.skipTransition).toHaveBeenCalledOnce()
    })

    it('keeps the slide of a page that is ready in time', async () => {
        const { onStart } = await startPlugin()
        const { transition, finishUpdate } = fakeTransition()

        onStart(transition)
        finishUpdate()
        await vi.advanceTimersByTimeAsync(1000)
        expect(transition.skipTransition).not.toHaveBeenCalled()
    })
})
