import { tvSettingsOf, type ResolvedTvSettings } from '#shared/utils/tvSettings'
import type { GymAmenity } from '#shared/utils/gymAmenities'
import { HOURS_DAYS, type GymOpeningHours } from '#shared/utils/openingHours'
import type { BoulderBandSetting } from '#shared/utils/gradeReference'
import {
    DEFAULT_BOULDER_GRADE_SYSTEM,
    DEFAULT_ROUTE_GRADE_SYSTEM,
} from '#shared/utils/grades'
import type { GymRecord } from '~/types/models'
import { DEFAULT_LOCALE } from '~/utils/locales'
import { legalFieldsFrom, legalPayload } from '~/utils/legalFields'
import { tvSettingsPayload } from '~/utils/tvScreen'

function hoursFrom(hours: GymOpeningHours | null | undefined) {
    return Object.fromEntries(
        HOURS_DAYS.map((day) => [
            day,
            (hours?.[day] ?? []).map((interval) => [...interval]),
        ]),
    ) as GymOpeningHours
}

function tvSettingsFrom(rec: Partial<GymRecord> | null): ResolvedTvSettings {
    const settings = tvSettingsOf(rec)
    return {
        screens: settings.screens.map((screen) => ({
            ...screen,
            slides: [...screen.slides],
        })),
        announcements: settings.announcements.map((announcement) => ({
            text: announcement.text,
            until: announcement.until ?? '',
        })),
    }
}

export function gymSettingsDraft(
    rec: GymRecord | null | undefined,
    defaultBands: () => BoulderBandSetting[],
) {
    return {
        imprint_url: rec?.imprint_url ?? '',
        privacy_url: rec?.privacy_url ?? '',
        name: rec?.name ?? '',
        unit_name: rec?.unit_name ?? '',
        short_name: rec?.short_name ?? '',
        contact_email: rec?.contact_email ?? '',
        language: (rec?.language || DEFAULT_LOCALE) as string,
        slug: rec?.slug ?? '',
        previous_slugs: [...(rec?.previous_slugs ?? [])],
        route_grade_system: (rec?.route_grade_system ||
            DEFAULT_ROUTE_GRADE_SYSTEM) as string,
        boulder_grade_system: (rec?.boulder_grade_system ||
            DEFAULT_BOULDER_GRADE_SYSTEM) as string,
        premoderate_betas: !!rec?.premoderate_betas,
        description: rec?.description ?? '',
        address: rec?.address ?? '',
        latitude: rec?.latitude ?? 0,
        longitude: rec?.longitude ?? 0,
        website_url: rec?.website_url ?? '',
        opening_hours: hoursFrom(rec?.opening_hours),
        hours_note: rec?.hours_note ?? '',
        amenities: [...(rec?.amenities ?? [])] as GymAmenity[],
        tv_settings: tvSettingsFrom(rec ?? null),
        ...legalFieldsFrom(rec ?? {}),
        boulder_bands: rec?.boulder_bands?.length
            ? rec.boulder_bands.map(({ name, color, to }) => ({
                  name,
                  color,
                  to,
              }))
            : defaultBands(),
    }
}

export type GymSettingsDraft = ReturnType<typeof gymSettingsDraft>

function gymSettingsPayload(state: GymSettingsDraft) {
    return {
        imprint_url: state.imprint_url,
        privacy_url: state.privacy_url,
        name: state.name,
        unit_name: state.unit_name,
        short_name: state.short_name,
        contact_email: state.contact_email,
        language: state.language,
        slug: state.slug,
        previous_slugs: state.previous_slugs,
        route_grade_system: state.route_grade_system,
        boulder_grade_system: state.boulder_grade_system,
        premoderate_betas: state.premoderate_betas,
        description: state.description,
        address: state.address,
        latitude: state.latitude,
        longitude: state.longitude,
        website_url: state.website_url,
        opening_hours: state.opening_hours,
        hours_note: state.hours_note,
        amenities: state.amenities,
        tv_settings: tvSettingsPayload(state.tv_settings),
        ...legalPayload(state),
        boulder_bands: state.boulder_bands.map(({ name, color, to }) => ({
            name: name.trim(),
            color,
            to,
        })),
    }
}

export function changedGymSettings(
    draft: GymSettingsDraft,
    pristine: GymSettingsDraft,
): Record<string, unknown> {
    const baseline: Record<string, unknown> = gymSettingsPayload(pristine)
    return Object.fromEntries(
        Object.entries(gymSettingsPayload(draft)).filter(
            ([field, value]) =>
                JSON.stringify(value) !== JSON.stringify(baseline[field]),
        ),
    )
}
