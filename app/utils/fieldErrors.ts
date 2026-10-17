const FIELD_ERROR_KEYS: Record<string, string> = {
    validation_email_blocked: 'errors.emailBlocked',
    validation_name_protected: 'errors.nameProtected',
}

export function fieldErrorCode(error: unknown, field: string) {
    const fields = (
        error as { response?: { data?: Record<string, { code?: string }> } }
    )?.response?.data
    return fields?.[field]?.code
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
    const fields = Object.keys(
        (error as { response?: { data?: Record<string, unknown> } })?.response
            ?.data ?? {},
    )
    return sent.filter((_, i) => fields.includes(`${field}.${i}`))
}
