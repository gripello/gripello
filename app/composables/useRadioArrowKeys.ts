import type { Ref } from 'vue'

const STEPS: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
}

export function useRadioArrowKeys(
    root: Readonly<Ref<HTMLElement | null | undefined>>,
    select: (index: number) => void,
) {
    return (event: KeyboardEvent) => {
        const step = STEPS[event.key]
        const radio = (event.target as Element | null)?.closest?.(
            '[role="radio"]',
        )
        if (!step || !radio || !root.value) return
        const radios = [
            ...root.value.querySelectorAll<HTMLElement>('[role="radio"]'),
        ]
        const index = radios.indexOf(radio as HTMLElement)
        if (index < 0) return
        event.preventDefault()
        const next = (index + step + radios.length) % radios.length
        select(next)
        radios[next]!.focus()
    }
}
