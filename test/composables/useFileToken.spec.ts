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
                    }))
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
})
