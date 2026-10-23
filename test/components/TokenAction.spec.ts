import { flushPromises, mount } from '@vue/test-utils'
import TokenAction from '~/components/auth/TokenAction.vue'

function mountAction(action: (token: string) => Promise<unknown>) {
    return mount(TokenAction, {
        props: {
            testidPrefix: 'email-change',
            brandHeadline: 'login',
            formHeading: { eyebrow: '', title: '', subtitle: '' },
            doneTitle: '',
            doneSubtitle: '',
            invalidSubtitle: '',
            action,
        },
        slots: {
            default: `<template #default="{ submit }">
                <button data-testid="submit" @click="submit(); submit()" />
            </template>`,
        },
        global: {
            stubs: {
                LayoutAuthLayout: { template: '<div><slot /></div>' },
                UIcon: true,
                UButton: true,
            },
        },
    })
}

describe('AuthTokenAction', () => {
    beforeEach(() => {
        vi.stubGlobal('useRoute', () => ({ params: { token: 'tok' } }))
        vi.stubGlobal(
            'routeParam',
            (params: Record<string, string>, name: string) => params[name],
        )
        vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
    })

    it('sends a link only once while a request is in flight', async () => {
        let calls = 0
        const action = vi.fn(async () => {
            calls += 1
            if (calls > 1) throw new Error('token already used')
        })
        const wrapper = mountAction(action)
        await wrapper.get('[data-testid="submit"]').trigger('click')
        await flushPromises()
        expect(action).toHaveBeenCalledTimes(1)
        expect(wrapper.find('[data-testid="email-change-done"]').exists()).toBe(
            true,
        )
    })
})
