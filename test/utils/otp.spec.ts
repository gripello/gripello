import { formatRecoveryCode, otpCode, otpDigits } from '~/utils/otp'

describe('otp', () => {
    it('round-trips a code through the digit boxes', () => {
        expect(otpDigits('012345')).toEqual([0, 1, 2, 3, 4, 5])
        expect(otpCode([0, 1, 2, 3, 4, 5])).toBe('012345')
    })

    it('ignores empty boxes', () => {
        expect(otpCode([1, undefined, 3])).toBe('13')
        expect(otpDigits('')).toEqual([])
    })

    it('formats recovery codes in groups of four', () => {
        expect(formatRecoveryCode('ABCD EFGH-ijkl2345')).toBe(
            'abcd-efgh-ijkl-2345',
        )
        expect(formatRecoveryCode('abcdefghijklmnopqrstu')).toBe(
            'abcd-efgh-ijkl-mnop',
        )
        expect(formatRecoveryCode('ab-')).toBe('ab')
    })
})
