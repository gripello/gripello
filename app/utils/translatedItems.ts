export function translatedItems<T extends string>(
    values: readonly T[],
    prefix: string,
    t: (key: string) => string,
): { value: T; label: string }[] {
    return values.map((value) => ({ value, label: t(`${prefix}.${value}`) }))
}
