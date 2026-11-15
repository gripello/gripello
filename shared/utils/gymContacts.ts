// Mirrored in backend/internal/gyms/contacts.go (fixture testdata/gymContacts.json).
export const GYM_CONTACT_KINDS = {
    front_desk: 'i-lucide-concierge-bell',
    privacy: 'i-lucide-shield-check',
    routesetting: 'i-lucide-mountain',
    competitions: 'i-lucide-trophy',
    courses: 'i-lucide-graduation-cap',
    other: 'i-lucide-user-round',
} as const

export type GymContactKind = keyof typeof GYM_CONTACT_KINDS

export const GYM_CONTACT_KIND_KEYS = Object.keys(
    GYM_CONTACT_KINDS,
) as GymContactKind[]

export const GYM_MAX_CONTACTS = 10
export const GYM_CONTACT_LABEL_MAX = 50
export const GYM_CONTACT_NAME_MAX = 100
export const GYM_CONTACT_PHONE_MAX = 100

export interface GymContact {
    kind: GymContactKind
    label?: string
    name?: string
    email?: string
    phone?: string
}

const CONTACT_KEYS = ['kind', 'label', 'name', 'email', 'phone']
const EMAIL =
    /^[^\s@"<>(),;:.]+(\.[^\s@"<>(),;:.]+)*@[^\s@"<>(),;:.]+(\.[^\s@"<>(),;:.]+)+$/

function textWithin(value: unknown, max: number) {
    return (
        value === undefined ||
        (typeof value === 'string' && [...value].length <= max)
    )
}

function isValidContact(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false
    }
    const contact = value as Record<string, unknown>
    if (Object.keys(contact).some((key) => !CONTACT_KEYS.includes(key))) {
        return false
    }
    const { kind, label, name, email, phone } = contact
    return (
        typeof kind === 'string' &&
        Object.hasOwn(GYM_CONTACT_KINDS, kind) &&
        textWithin(label, GYM_CONTACT_LABEL_MAX) &&
        textWithin(name, GYM_CONTACT_NAME_MAX) &&
        textWithin(phone, GYM_CONTACT_PHONE_MAX) &&
        (email === undefined ||
            email === '' ||
            (typeof email === 'string' && EMAIL.test(email))) &&
        (!!email || !!phone)
    )
}

export function isValidGymContacts(value: unknown): boolean {
    return (
        value === null ||
        (Array.isArray(value) &&
            value.length <= GYM_MAX_CONTACTS &&
            value.every(isValidContact))
    )
}

export function privacyContact(contacts: GymContact[] | null | undefined) {
    return contacts?.find(
        (contact) =>
            contact.kind === 'privacy' && (contact.email || contact.phone),
    )
}
