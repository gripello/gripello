import { afterEach, describe, expect, it } from 'vitest'
import {
    canPullFrom,
    PULL_THRESHOLD,
    pullGesture,
    pullOffset,
} from '~/utils/pullToRefresh'

describe('pullOffset', () => {
    it('follows the finger with resistance and stops at a maximum', () => {
        expect(pullOffset(-20)).toBe(0)
        expect(pullOffset(2 * PULL_THRESHOLD)).toBe(PULL_THRESHOLD)
        expect(pullOffset(10_000)).toBe(120)
    })
})

describe('pullGesture', () => {
    it('waits until the finger has clearly moved', () => {
        expect(pullGesture(3, 6)).toBe('undecided')
    })

    it('pulls on a mostly downward move and lets sideways swipes go', () => {
        expect(pullGesture(4, 20)).toBe('pull')
        expect(pullGesture(25, 15)).toBe('cancel')
        expect(pullGesture(0, -15)).toBe('cancel')
    })
})

describe('canPullFrom', () => {
    afterEach(() => (document.body.innerHTML = ''))

    function target(html: string) {
        document.body.innerHTML = html
        return document.getElementById('target')
    }

    it('pulls from plain content at the top of the page', () => {
        expect(canPullFrom(target('<main><p id="target"></p></main>'), 0)).toBe(
            true,
        )
    })

    it('leaves a scrolled page alone', () => {
        expect(canPullFrom(target('<p id="target"></p>'), 40)).toBe(false)
    })

    it('leaves scrolled inner lists, dialogs and gesture surfaces alone', () => {
        const inList = target('<div><p id="target"></p></div>')
        inList!.parentElement!.scrollTop = 30
        expect(canPullFrom(inList, 0)).toBe(false)
        expect(
            canPullFrom(
                target('<div role="dialog"><p id="target"></p></div>'),
                0,
            ),
        ).toBe(false)
        expect(
            canPullFrom(
                target(
                    '<div style="touch-action: none"><p id="target"></p></div>',
                ),
                0,
            ),
        ).toBe(false)
    })
})
