// The reauthenticate endpoint answers a wrong password with field code invalid_password.
export function isWrongPassword(error: unknown) {
    const data = (error as { response?: { data?: unknown } })?.response?.data
    return (
        (data as Record<string, { code?: string }> | undefined)?.password
            ?.code === 'invalid_password'
    )
}

// Accounts that only sign in through a provider answer every password confirmation with password_required.
export function needsPasswordFirst(error: unknown) {
    const data = (error as { response?: { data?: unknown } })?.response?.data
    return Object.values(
        (data ?? {}) as Record<string, { code?: string } | undefined>,
    ).some((field) => field?.code === 'password_required')
}
