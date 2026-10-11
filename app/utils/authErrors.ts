export function isInvalidCredentials(message: string) {
    return /invalid.+credentials|failed to authenticate/i.test(message)
}
