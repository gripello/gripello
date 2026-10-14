import type { LegalFields } from '~/types/models'
import {
    privacyDocOrDefault,
    privacyDocPayload,
    type RichTextDoc,
} from '#shared/utils/privacyDoc'

export function legalFieldsFrom(rec: LegalFields) {
    return {
        legal_address: rec.legal_address ?? '',
        legal_phone: rec.legal_phone ?? '',
        legal_register: rec.legal_register ?? '',
        legal_vat_id: rec.legal_vat_id ?? '',
        legal_editorial: rec.legal_editorial ?? '',
        legal_representatives: (rec.legal_representatives ?? []).map(
            (person) => ({
                name: person.name ?? '',
                role: person.role ?? '',
            }),
        ),
        privacy_doc: JSON.parse(
            JSON.stringify(privacyDocOrDefault(rec.privacy_doc)),
        ) as RichTextDoc,
    }
}

export type LegalFieldsState = ReturnType<typeof legalFieldsFrom>

export function legalPayload(state: LegalFields) {
    const fields = legalFieldsFrom(state)
    fields.legal_representatives = fields.legal_representatives
        .map((person) => ({
            name: person.name.trim(),
            role: person.role.trim(),
        }))
        .filter((person) => person.name)
    return {
        ...fields,
        privacy_doc: privacyDocPayload(fields.privacy_doc),
    }
}
