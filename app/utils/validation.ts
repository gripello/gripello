export type TranslateFn = (
    key: string,
    params?: Record<string, unknown>,
    plural?: number,
) => string
export type Rule = (v: unknown) => true | string

export const required =
    (t: TranslateFn): Rule =>
    (v) =>
        (v !== null && v !== undefined && v !== '') || t('validation.required')

export const minLength =
    (t: TranslateFn, n: number): Rule =>
    (v) =>
        (typeof v === 'string' && v.length >= n) ||
        t('validation.minLength', { n }, n)

export const maxLength =
    (t: TranslateFn, n: number): Rule =>
    (v) =>
        (typeof v === 'string' && v.length <= n) ||
        t('validation.maxLength', { n }, n)

export const validEmail =
    (t: TranslateFn): Rule =>
    (v) =>
        /.+@.+\..+/.test(String(v ?? '')) || t('validation.email')

export const validUsername = (t: TranslateFn): Rule[] => [
    required(t),
    minLength(t, 3),
    (v) =>
        /^[\w][\w.-]*$/.test(String(v ?? '')) || t('account.usernameInvalid'),
]

export const passwordsMatch =
    (t: TranslateFn, getPassword: () => string): Rule =>
    (v) =>
        v === getPassword() || t('validation.passwordMismatch')

export const nonBlank =
    (t: TranslateFn): Rule =>
    (v) =>
        (typeof v === 'string' && v.trim() !== '') || t('validation.required')

export const integerBetween =
    (t: TranslateFn, min: number, max: number): Rule =>
    (v) =>
        (Number.isInteger(v) && (v as number) >= min && (v as number) <= max) ||
        t('validation.integerRange', { min, max })

export interface FieldError {
    name: string
    message: string
}

export function validateRules(
    state: Record<string, unknown>,
    rules: Record<string, Rule[]>,
): FieldError[] {
    return Object.entries(rules).flatMap(([name, fieldRules]) => {
        const message = fieldRules
            .map((rule) => rule(state[name]))
            .find((result) => result !== true)
        return message ? [{ name, message }] : []
    })
}
