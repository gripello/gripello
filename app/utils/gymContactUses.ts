import type { GymContact } from '#shared/utils/gymContacts'

export type ContactUseKey =
    'info' | 'imprint' | 'privacy' | 'replyTo' | 'appeals'

export interface ContactUse {
    key: ContactUseKey
    fallback: boolean
}

const use = (key: ContactUseKey, fallback = false): ContactUse => ({
    key,
    fallback,
})

function appealsContactIndex(contacts: GymContact[]) {
    return contacts.findIndex(
        (contact) => contact.kind === 'privacy' && !!contact.email?.trim(),
    )
}

function privacyContactIndex(contacts: GymContact[]) {
    return contacts.findIndex(
        (contact) =>
            contact.kind === 'privacy' &&
            !!(contact.email?.trim() || contact.phone?.trim()),
    )
}

export function generalContactUses(
    general: { email: string; phone: string },
    contacts: GymContact[],
): ContactUse[] {
    if (!general.email.trim() && !general.phone.trim()) return []
    const uses = [use('info'), use('imprint'), use('privacy')]
    if (!general.email.trim()) return uses
    uses.push(use('replyTo'))
    if (appealsContactIndex(contacts) < 0) uses.push(use('appeals', true))
    return uses
}

export function roleContactUses(
    contacts: GymContact[],
    index: number,
): ContactUse[] {
    const uses = [use('info')]
    if (privacyContactIndex(contacts) === index) uses.push(use('privacy'))
    if (appealsContactIndex(contacts) === index) uses.push(use('appeals'))
    return uses
}

export function contactLines(
    contact: { email?: string; phone?: string },
    empty?: string,
) {
    const lines = [contact.email, contact.phone].filter((line) => !!line)
    return lines.length || !empty ? (lines as string[]) : [empty]
}
