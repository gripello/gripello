import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useFileToken } from '~/composables/useFileToken'
import { routeApi } from '../api/apiMock'

describe('useFileToken', () => {
    it('requests a token for the shown record and a new one when it changes', async () => {
        const api = vi.fn(
            async (_path: string, options?: { body?: { id: string } }) => ({
                token: `token-${options?.body?.id}`,
            }),
        )
        routeApi(api)
        const id = ref('t1')
        let token = ref('')
        mount(
            defineComponent({
                setup() {
                    token = useFileToken(() => ({
                        table: 'tasks',
                        id: id.value,
                    })).token
                    return () => h('div')
                },
            }),
        )
        await flushPromises()
        expect(token.value).toBe('token-t1')
        expect(api).toHaveBeenCalledWith('/files/token', {
            method: 'POST',
            body: { table: 'tasks', id: 't1' },
        })

        id.value = 't2'
        await flushPromises()
        expect(token.value).toBe('token-t2')
    })

    it('keeps a token for rendered files and renews it only once it may have expired', async () => {
        vi.useFakeTimers()
        let issued = 0
        routeApi(async () => ({ token: `token-${++issued}` }))
        let fileToken = {} as ReturnType<typeof useFileToken>
        mount(
            defineComponent({
                setup() {
                    fileToken = useFileToken(() => ({
                        table: 'tasks',
                        id: 't1',
                    }))
                    return () => h('div')
                },
            }),
        )
        expect(fileToken.token.value).toBe('')
        await flushPromises()
        expect(fileToken.token.value).toBe('token-1')

        fileToken.renew()
        await vi.advanceTimersByTimeAsync(300_000)
        expect(fileToken.token.value).toBe('token-1')

        fileToken.renew()
        await flushPromises()
        expect(fileToken.token.value).toBe('token-2')
        fileToken.renew()
        await flushPromises()
        expect(fileToken.token.value).toBe('token-2')
        vi.useRealTimers()
    })

    it('asks for nothing without a record', async () => {
        const api = vi.fn()
        routeApi(api)
        mount(
            defineComponent({
                setup() {
                    useFileToken(() => null)
                    return () => h('div')
                },
            }),
        )
        await flushPromises()
        expect(api).not.toHaveBeenCalled()
    })

    it('retries a failed token request so protected files still show up', async () => {
        vi.useFakeTimers()
        let calls = 0
        routeApi(async () => {
            if (++calls === 1) throw new Error('unavailable')
            return { token: 'late-token' }
        })
        let fileToken = {} as ReturnType<typeof useFileToken>
        mount(
            defineComponent({
                setup() {
                    fileToken = useFileToken(() => ({
                        table: 'tasks',
                        id: 't1',
                    }))
                    return () => h('div')
                },
            }),
        )
        await flushPromises()
        expect(fileToken.token.value).toBe('')
        await vi.advanceTimersByTimeAsync(2_000)
        expect(fileToken.token.value).toBe('late-token')
        vi.useRealTimers()
    })

    it('keeps the working token when renewing it fails', async () => {
        vi.useFakeTimers()
        let calls = 0
        routeApi(async () => {
            if (++calls === 2) throw new Error('unavailable')
            return { token: `token-${calls}` }
        })
        let fileToken = {} as ReturnType<typeof useFileToken>
        mount(
            defineComponent({
                setup() {
                    fileToken = useFileToken(() => ({
                        table: 'tasks',
                        id: 't1',
                    }))
                    return () => h('div')
                },
            }),
        )
        await flushPromises()
        await vi.advanceTimersByTimeAsync(60_000)
        fileToken.renew()
        await flushPromises()
        expect(fileToken.token.value).toBe('token-1')
        vi.useRealTimers()
    })

    it('stops retrying once the card is gone', async () => {
        vi.useFakeTimers()
        let answer!: (error: Error) => void
        const api = vi.fn(
            () => new Promise((_resolve, reject) => (answer = reject)),
        )
        routeApi(api)
        const wrapper = mount(
            defineComponent({
                setup() {
                    useFileToken(() => ({ table: 'tasks', id: 't1' }))
                    return () => h('div')
                },
            }),
        )
        await flushPromises()
        wrapper.unmount()
        answer(new Error('unavailable'))
        await vi.advanceTimersByTimeAsync(10_000)
        expect(api).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })
})
