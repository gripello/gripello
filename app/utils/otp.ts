export const OTP_LENGTH = 6

export function otpDigits(code: string): number[] {
    return [...code].map(Number)
}

export function otpCode(digits: (number | undefined)[]): string {
    return digits
        .filter((digit): digit is number => digit !== undefined)
        .join('')
}

export function formatRecoveryCode(input: string): string {
    return (
        input
            .toLowerCase()
            .replace(/[^a-z2-7]/g, '')
            .slice(0, 16)
            .match(/.{1,4}/g)
            ?.join('-') ?? ''
    )
}
