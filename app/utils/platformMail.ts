import type { MailSettingsInput } from '~/api/platform'

export interface MailSettingsForm {
    smtp_host: string
    smtp_port: number
    smtp_username: string
    smtp_password: string
    clearPassword: boolean
    smtp_tls: boolean
    sender_address: string
    sender_name: string
}

// A typed password replaces the stored one, clearPassword removes it, otherwise the stored one stays.
export function mailSettingsPayload(form: MailSettingsForm): MailSettingsInput {
    const { smtp_password, clearPassword, ...rest } = form
    return {
        ...rest,
        smtp_host: rest.smtp_host.trim(),
        sender_address: rest.sender_address.trim(),
        sender_name: rest.sender_name.trim(),
        ...(smtp_password
            ? { smtp_password }
            : clearPassword
              ? { smtp_password: '' }
              : {}),
    }
}

export function implicitTlsPort(port: number | null | undefined) {
    return port === 465
}

export const SMTP_STAGES = ['connect', 'encrypt', 'sign_in', 'deliver'] as const
export type SmtpStage = (typeof SMTP_STAGES)[number]
export type SmtpCheck = { ok: true } | { stage: SmtpStage; message: string }

// The test-mail endpoint answers a failure with field `smtp` whose code names the broken step.
export function smtpFailure(error: unknown): SmtpCheck | null {
    const data = (error as { response?: { data?: unknown } })?.response?.data
    const field = (
        data as Record<string, { code?: string; message?: string }> | undefined
    )?.smtp
    if (!field?.code || !SMTP_STAGES.includes(field.code as SmtpStage))
        return null
    return { stage: field.code as SmtpStage, message: field.message ?? '' }
}

// Steps before the failed one passed, the failed one carries the message, later ones never ran.
export function smtpCheckSteps(check: SmtpCheck | null) {
    const failedAt =
        check && 'stage' in check ? SMTP_STAGES.indexOf(check.stage) : -1
    return SMTP_STAGES.map((stage, index) => ({
        stage,
        state: !check
            ? ('idle' as const)
            : 'ok' in check || index < failedAt
              ? ('ok' as const)
              : index === failedAt
                ? ('failed' as const)
                : ('skipped' as const),
        message:
            index === failedAt && check && 'message' in check
                ? check.message
                : '',
    }))
}

// Platform settings and backups load in the browser only: their dates render in the viewer's time zone and their
// forms are filled from the loaded record, so server-rendered markup would never match.
export const CLIENT_ONLY = { server: false } as const
