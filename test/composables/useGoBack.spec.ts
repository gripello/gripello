import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForcedPop, useGoBack, usePageBackTo } from '~/composables/useGoBack'

let path = '/gym-a/route'
const back = vi.fn()
const navigateTo = vi.fn()

beforeEach(() => {
    path = '/gym-a/route'
    vi.stubGlobal('useRoute', () => ({ path }))
    vi.stubGlobal('useRouter', () => ({ back }))
    vi.stubGlobal('navigateTo', navigateTo)
    usePageBackTo().value = null
    useForcedPop().value = false
})

afterEach(() => {
    window.history.replaceState(null, '')
    back.mockReset()
    navigateTo.mockReset()
})

describe('useGoBack', () => {
    it('goes back in history when the app has a previous entry', () => {
        window.history.replaceState({ back: '/gym-a' }, '')
        useGoBack().goBack()
        expect(back).toHaveBeenCalledOnce()
        expect(navigateTo).not.toHaveBeenCalled()
        expect(useForcedPop().value).toBe(false)
    })

    it('replaces a deep-linked page with its parent and animates it as a pop', () => {
        useGoBack().goBack()
        expect(navigateTo).toHaveBeenCalledWith('/gym-a/routes', {
            replace: true,
        })
        expect(useForcedPop().value).toBe(true)
    })

    it('falls back to the start page on a tab root', () => {
        path = '/gym-a/manage/routes'
        useGoBack().goBack()
        expect(navigateTo).toHaveBeenCalledWith('/', { replace: true })
    })

    it('lets the page header override the parent', () => {
        usePageBackTo().value = { owner: 1, to: '/gym-a/manage/tasks' }
        useGoBack().goBack()
        expect(navigateTo).toHaveBeenCalledWith('/gym-a/manage/tasks', {
            replace: true,
        })
    })
})
