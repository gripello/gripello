export default defineAppConfig({
    ui: {
        colors: {
            primary: 'green',
            secondary: 'teal',
            neutral: 'neutral',
        },
        button: {
            compoundVariants: [{ square: true, class: 'icon-btn' }],
        },
        input: {
            defaultVariants: { size: 'lg' },
        },
        inputNumber: {
            defaultVariants: { size: 'lg' },
        },
        select: {
            defaultVariants: { size: 'lg' },
        },
        selectMenu: {
            defaultVariants: { size: 'lg' },
        },
        inputMenu: {
            defaultVariants: { size: 'lg' },
        },
        textarea: {
            defaultVariants: { size: 'lg' },
        },
        table: {
            slots: {
                root: 'rounded-lg border border-default bg-default',
                thead: 'bg-elevated',
                th: 'text-highlighted',
            },
        },
    },
})
