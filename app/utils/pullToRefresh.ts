export const PULL_THRESHOLD = 72
const MAX_PULL = 120
const RESISTANCE = 0.5

const GESTURE_SLOP = 10

export type PullGesture = 'pull' | 'cancel' | 'undecided'

export function pullGesture(dx: number, dy: number): PullGesture {
    if (Math.abs(dx) < GESTURE_SLOP && Math.abs(dy) < GESTURE_SLOP)
        return 'undecided'
    return dy > Math.abs(dx) ? 'pull' : 'cancel'
}

export const pullOffset = (fingerDistance: number) =>
    Math.max(0, Math.min(MAX_PULL, fingerDistance * RESISTANCE))

export function canPullFrom(target: Element | null, scrollY: number) {
    if (scrollY > 0) return false
    for (let el = target; el && el !== document.body; el = el.parentElement) {
        if (el.scrollTop > 0) return false
        if (el.matches('[role="dialog"], [data-slot="overlay"]')) return false
        const touchAction = getComputedStyle(el).touchAction
        if (touchAction === 'none' || touchAction === 'pan-x') return false
    }
    return true
}
