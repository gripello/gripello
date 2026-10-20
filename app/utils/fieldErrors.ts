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

const FIELD_MESSAGE_KEYS: Record<string, string> = {
    ...FIELD_ERROR_KEYS,
    validation_required: 'validation.required',
    validation_is_email: 'validation.email',
}

export function formFieldErrors(
    error: unknown,
    fields: readonly string[],
    t: (key: string) => string,
) {
    return fields.flatMap((name) => {
        const code = fieldErrorCode(error, name)
        if (!code) return []
        return [
            {
                name,
                message: t(FIELD_MESSAGE_KEYS[code] ?? 'validation.invalid'),
            },
        ]
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
