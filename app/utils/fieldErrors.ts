import type { TranslateFn } from '~/utils/validation'

const FIELD_ERROR_KEYS: Record<string, string> = {
    validation_email_blocked: 'errors.emailBlocked',
    validation_name_protected: 'errors.nameProtected',
}

export type FieldErrorDetail = { code?: string; message?: string }

export function apiFieldErrors(
    error: unknown,
): Record<string, FieldErrorDetail> {
    const fields = (error as { response?: { data?: unknown } })?.response?.data
    return fields && typeof fields === 'object'
        ? (fields as Record<string, FieldErrorDetail>)
        : {}
}

export function fieldErrorCode(error: unknown, field: string) {
    return apiFieldErrors(error)[field]?.code
}

export const FIELD_MESSAGE_KEYS: Record<string, string> = {
    ...FIELD_ERROR_KEYS,
    validation_required: 'validation.required',
    validation_is_email: 'validation.email',
    validation_invalid_email: 'validation.email',
    validation_not_unique: 'validation.notUnique',
    validation_slug_used: 'gymOnboarding.slugTaken',
    validation_invalid_previous_slugs: 'validation.previousSlugs',
    validation_invalid_url: 'validation.httpsUrl',
    validation_invalid_format: 'account.usernameInvalid',
    validation_invalid_password: 'account.wrongPassword',
    validation_invalid_old_password: 'account.wrongPassword',
    validation_values_mismatch: 'validation.passwordMismatch',
    validation_invalid_token: 'validation.linkInvalid',
    validation_invalid_role: 'validation.role',
    validation_missing_rel_records: 'validation.missingRecord',
    validation_invalid_permission: 'validation.permission',
    validation_last_admin: 'account.lastAdmin',
    validation_own_email: 'validation.ownEmail',
    validation_already_reviewed: 'ratings.alreadyReviewed',
    validation_wall_has_routes: 'validation.wallHasRoutes',
}

// Their messages carry the limits; validation_invalid_<field> codes come from the gym settings.
export const LIMIT_CODES = new Set([
    'validation_invalid',
    'validation_invalid_value',
    'validation_invalid_date',
    'validation_invalid_port',
    'validation_length_out_of_range',
    'validation_max_text_constraint',
    'validation_out_of_range',
    'validation_too_many_values',
])

function limitMessage(code: string, message: string, t: TranslateFn) {
    let m = /(?:at most|no more than) (\d+) (?:character|letter)/i.exec(message)
    if (m) return t('validation.maxLength', { n: +m[1]! }, +m[1]!)
    m = /at least (\d+) character/i.exec(message)
    if (m) return t('validation.minLength', { n: +m[1]! }, +m[1]!)
    m = /(?:between (-?\d+) and|(\d+) to) (\d+)/i.exec(message)
    if (m) {
        const params = { min: +(m[1] ?? m[2])!, max: +m[3]! }
        return code.includes('length') || /letters|characters/i.test(message)
            ? t('validation.lengthRange', params)
            : t('validation.integerRange', params)
    }
    m = /no more than (\d+)/i.exec(message)
    if (m && code === 'validation_too_many_values')
        return t('validation.tooMany', { n: +m[1]! }, +m[1]!)
    m = /^Must be at least (\d+)\.$/.exec(message)
    if (m) return t('validation.atLeast', { n: +m[1]! })
    if (/future|in the past/i.test(message)) return t('validation.futureDate')
    if (/YYYY-MM-DD|RFC 3339|\bdate\b/i.test(message))
        return t('validation.date')
    return t(
        /too long/i.test(message) ? 'validation.tooLong' : 'validation.invalid',
    )
}

function fieldErrorMessage(detail: FieldErrorDetail, t: TranslateFn) {
    const code = detail.code ?? ''
    const key = FIELD_MESSAGE_KEYS[code]
    if (key) return t(key)
    if (LIMIT_CODES.has(code) || code.startsWith('validation_invalid_'))
        return limitMessage(code, detail.message ?? '', t)
    return t('validation.invalid')
}

export function formFieldErrors(
    error: unknown,
    fields: readonly string[],
    t: TranslateFn,
) {
    const details = apiFieldErrors(error)
    return fields.flatMap((name) => {
        const detail = details[name]
        if (!detail?.code) return []
        return [{ name, message: fieldErrorMessage(detail, t) }]
    })
}

// The i18n key for a blocklist rejection of one of fields, so forms can show it instead of a generic failure.
export function blockedFieldError(error: unknown, fields: string[]) {
    for (const name of fields) {
        const key = FIELD_ERROR_KEYS[fieldErrorCode(error, name) ?? '']
        if (key) return { name, key }
    }
    return null
}

export function linesToList(text: string) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
}

// Field keys look like blocked_emails.3; returns the entries the server refused.
export function refusedEntries(error: unknown, field: string, sent: string[]) {
    const fields = Object.keys(apiFieldErrors(error))
    return sent.filter((_, i) => fields.includes(`${field}.${i}`))
}
