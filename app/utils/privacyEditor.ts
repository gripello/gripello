import { CLIENT_STORAGE } from '~/utils/clientStorage'
import type { LegalFields } from '~/types/models'
import {
    MAX_PRIVACY_DOC,
    hasRequiredPrivacyBlocks,
    isPrivacyTextSection,
    privacyDocPayload,
    type PrivacyBlockKey,
    type RichTextDoc,
} from '#shared/utils/privacyDoc'

const DATA_BLOCK_TITLES: Partial<Record<PrivacyBlockKey, string>> = {
    controller: 'legal.privacyPage.controllerTitle',
    contact: 'legal.imprintPage.contact',
    storage: 'legal.privacyPage.storage.title',
    rights: 'legal.privacyPage.rights.title',
}

export function privacyBlockTitleKey(key: PrivacyBlockKey) {
    return DATA_BLOCK_TITLES[key] ?? `legal.privacyPage.${key}.title`
}

export const PRIVACY_PLACEHOLDERS = [
    'gym',
    'address',
    'email',
    'phone',
    'auditDays',
] as const

export const PRIVACY_RIGHTS = [
    'access',
    'rectification',
    'erasure',
    'restriction',
    'portability',
    'objection',
    'withdrawal',
] as const

type Translate = (key: string, params?: Record<string, unknown>) => string

export interface PrivacyBlockContext {
    controller?: (LegalFields & { name?: string }) | null
    auditDays: number
}

function contactLines(t: Translate, source: LegalFields | null | undefined) {
    const people = (source?.legal_representatives ?? [])
        .filter((person) => person.name)
        .map((person) =>
            person.role ? `${person.name} – ${person.role}` : person.name,
        )
    return [
        ...(people.length
            ? [t('legal.imprintPage.representative'), ...people]
            : []),
        ...(source?.legal_phone
            ? [`${t('legal.imprintPage.phone')}: ${source.legal_phone}`]
            : []),
        ...(source?.contact_email
            ? [`${t('legal.imprintPage.email')}: ${source.contact_email}`]
            : []),
        ...(source?.legal_register
            ? [
                  `${t('legal.imprintPage.registerEntry')}: ${source.legal_register}`,
              ]
            : []),
        ...(source?.legal_vat_id
            ? [`${t('legal.imprintPage.vatId')}: ${source.legal_vat_id}`]
            : []),
        ...(source?.legal_editorial
            ? [`${t('legal.imprintPage.editorial')}: ${source.legal_editorial}`]
            : []),
    ]
}

// The block as it reads on the page, title first, one entry per line.
export function privacyBlockText(
    key: PrivacyBlockKey,
    t: Translate,
    { controller, auditDays }: PrivacyBlockContext,
): string {
    const title = t(privacyBlockTitleKey(key))
    let body: string[]
    switch (key) {
        case 'controller':
            body = [
                controller?.name,
                controller?.legal_address,
                controller?.contact_email,
            ].filter((line): line is string => !!line)
            break
        case 'contact':
            body = contactLines(t, controller)
            break
        case 'storage':
            body = [
                t('legal.privacyPage.storage.body'),
                ...CLIENT_STORAGE.map((entry) =>
                    [
                        entry.name,
                        t(`legal.storage.kinds.${entry.kind}`),
                        t(`legal.storage.purposes.${entry.purpose}`),
                        t(`legal.storage.durations.${entry.duration}`),
                    ].join(' · '),
                ),
            ]
            break
        case 'rights':
            body = [
                t('legal.privacyPage.rights.body'),
                ...PRIVACY_RIGHTS.map(
                    (right) =>
                        `• ${t(`legal.privacyPage.rights.items.${right}`)}`,
                ),
                t('legal.privacyPage.rights.complaint'),
            ]
            break
        default:
            body = isPrivacyTextSection(key)
                ? [t(`legal.privacyPage.${key}.body`, { auditDays })]
                : []
    }
    return [title, ...body].join('\n')
}

export function privacyDocProblem(doc: RichTextDoc, t: Translate) {
    if (!hasRequiredPrivacyBlocks(doc)) return t('settings.privacy.required')
    const stored = privacyDocPayload(doc)
    if (stored && [...JSON.stringify(stored)].length > MAX_PRIVACY_DOC)
        return t('settings.privacy.tooLong')
    return ''
}
