import { describe, expect, it } from 'vitest'
import {
    implicitTlsPort,
    mailSettingsPayload,
    smtpCheckSteps,
    smtpFailure,
} from '~/utils/platformMail'

const form = {
    smtp_host: ' smtp.example.com ',
    smtp_port: 465,
    smtp_username: 'mailer',
    smtp_password: '',
    clearPassword: false,
    smtp_tls: true,
    sender_address: ' no-reply@example.com ',
    sender_name: 'Hall',
}

describe('mailSettingsPayload', () => {
    it('keeps the stored password when none was typed', () => {
        const payload = mailSettingsPayload(form)
        expect(payload).not.toHaveProperty('smtp_password')
        expect(payload).toMatchObject({
            smtp_host: 'smtp.example.com',
            sender_address: 'no-reply@example.com',
        })
        expect(payload).not.toHaveProperty('clearPassword')
    })

    it('sends a typed password and clears on request', () => {
        expect(
            mailSettingsPayload({ ...form, smtp_password: 'new' })
                .smtp_password,
        ).toBe('new')
        expect(
            mailSettingsPayload({ ...form, clearPassword: true }).smtp_password,
        ).toBe('')
    })
})

describe('implicitTlsPort', () => {
    it('is only on for the SMTPS port', () => {
        expect(implicitTlsPort(465)).toBe(true)
        expect(implicitTlsPort(587)).toBe(false)
        expect(implicitTlsPort(25)).toBe(false)
        expect(implicitTlsPort(null)).toBe(false)
    })
})

describe('smtp connection check', () => {
    it('reads the failed step from the API error', () => {
        const err = {
            response: {
                data: { smtp: { code: 'sign_in', message: '535 invalid' } },
            },
        }
        expect(smtpFailure(err)).toEqual({
            stage: 'sign_in',
            message: '535 invalid',
        })
        expect(smtpFailure(new Error('offline'))).toBeNull()
    })

    it('marks steps before the failure as passed and later ones as skipped', () => {
        expect(
            smtpCheckSteps({ stage: 'sign_in', message: '535' }).map(
                (s) => s.state,
            ),
        ).toEqual(['ok', 'ok', 'failed', 'skipped'])
        expect(
            smtpCheckSteps({ ok: true }).every((s) => s.state === 'ok'),
        ).toBe(true)
        expect(smtpCheckSteps(null)[0]?.state).toBe('idle')
    })
})
