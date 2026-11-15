// Nuxt composables (useI18n, useNotification, useRoute…) only work while a plugin or component sets up;
// after an await they throw. setupOnly() makes a stub behave the same so tests catch late calls.
let inSetup = false

export function setupOnly<T extends (...args: never[]) => unknown>(
    name: string,
    stub: T,
): T {
    return ((...args: Parameters<T>) => {
        if (!inSetup)
            throw new SyntaxError(
                `${name}: Must be called at the top of a \`setup\` function`,
            )
        return stub(...args)
    }) as T
}

export function runSetup<T>(setup: () => T): T {
    inSetup = true
    try {
        return setup()
    } finally {
        inSetup = false
    }
}
