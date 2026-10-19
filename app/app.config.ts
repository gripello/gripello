import type { AppConfigInput } from 'nuxt/schema'

// iOS zooms into focused fields below 16px
const touchSafeFontSize = {
    defaultVariants: { size: 'lg' },
    compoundVariants: [
        { size: ['xs', 'sm'], class: { base: 'pointer-coarse:text-base/4' } },
    ],
}

export default {
    ui: {
        colors: {
            primary: 'green',
            secondary: 'teal',
            neutral: 'neutral',
        },
        button: {
            compoundVariants: [{ square: true, class: 'icon-btn' }],
        },
        input: touchSafeFontSize,
        inputNumber: touchSafeFontSize,
        select: touchSafeFontSize,
        selectMenu: touchSafeFontSize,
        inputMenu: touchSafeFontSize,
        textarea: touchSafeFontSize,
        table: {
            slots: {
                root: 'rounded-lg border border-default bg-default',
                thead: 'bg-elevated',
                th: 'text-highlighted',
            },
        },
    },
} satisfies AppConfigInput
