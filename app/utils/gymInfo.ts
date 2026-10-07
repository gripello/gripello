import { hasOpeningHours } from '#shared/utils/openingHours'
import type { GymRecord } from '~/types/models'
import { gymTitle } from './gymNames'

export interface GymMapMarker {
    id: string
    lat: number
    lng: number
    label?: string
    logo?: string
}

type GymLocation = Pick<GymRecord, 'latitude' | 'longitude'>

// PocketBase stores an empty number field as 0.
export const hasLocation = (gym: GymLocation | null | undefined) =>
    !!(gym?.latitude || gym?.longitude)

export function directionLinks(gym: GymLocation & Pick<GymRecord, 'address'>) {
    const coords = `${gym.latitude},${gym.longitude}`
    const query = encodeURIComponent(gym.address || coords)
    return [
        {
            key: 'osm',
            href: `https://www.openstreetmap.org/?mlat=${gym.latitude}&mlon=${gym.longitude}#map=17/${gym.latitude}/${gym.longitude}`,
        },
        {
            key: 'google',
            href: `https://www.google.com/maps/dir/?api=1&destination=${coords}`,
        },
        {
            key: 'apple',
            href: `https://maps.apple.com/?daddr=${coords}&q=${query}`,
        },
    ]
}

export function preferredDirections(
    gym: GymLocation & Pick<GymRecord, 'address'>,
    userAgent: string,
) {
    const links = Object.fromEntries(
        directionLinks(gym).map((link) => [link.key, link.href]),
    )
    if (/iPhone|iPad|Macintosh/.test(userAgent)) return links.apple!
    if (/Android/.test(userAgent))
        return `geo:${gym.latitude},${gym.longitude}?q=${gym.latitude},${gym.longitude}`
    return links.google!
}

export function hasGymInfo(gym: Partial<GymRecord> | null | undefined) {
    return !!(
        gym &&
        (gym.description ||
            gym.address ||
            hasLocation(gym) ||
            hasOpeningHours(gym.opening_hours) ||
            gym.amenities?.length ||
            gym.website_url ||
            gym.legal_phone ||
            gym.contact_email)
    )
}

type MarkedGym = Pick<
    GymRecord,
    'id' | 'name' | 'unit_name' | 'latitude' | 'longitude'
>

export function gymMarkers<T extends MarkedGym>(
    gyms: T[],
    logoUrl: (gym: T) => string = () => '',
): GymMapMarker[] {
    return gyms.filter(hasLocation).map((gym) => ({
        id: gym.id,
        lat: gym.latitude!,
        lng: gym.longitude!,
        label: gymTitle(gym),
        logo: logoUrl(gym) || undefined,
    }))
}

export function gymContacts(
    gym: Pick<GymRecord, 'legal_phone' | 'contact_email' | 'website_url'>,
) {
    return [
        gym.legal_phone && {
            key: 'phone',
            icon: 'i-lucide-phone',
            label: gym.legal_phone,
            href: `tel:${gym.legal_phone.replace(/[^\d+]/g, '')}`,
        },
        gym.contact_email && {
            key: 'email',
            icon: 'i-lucide-mail',
            label: gym.contact_email,
            href: `mailto:${gym.contact_email}`,
        },
        gym.website_url && {
            key: 'website',
            icon: 'i-lucide-globe',
            label: gym.website_url.replace(/^https?:\/\/(www\.)?/, ''),
            href: gym.website_url,
        },
    ].filter((contact) => !!contact)
}

export async function geocodeAddress(
    address: string,
): Promise<[number, number] | null> {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.search = new URLSearchParams({
        format: 'jsonv2',
        limit: '1',
        q: address.replace(/\s*\n\s*/g, ', '),
    }).toString()
    const response = await fetch(url)
    if (!response.ok) return null
    const [hit] = (await response.json()) as { lat: string; lon: string }[]
    return hit ? [Number(hit.lat), Number(hit.lon)] : null
}

interface NominatimAddress {
    road?: string
    pedestrian?: string
    house_number?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
}

export function formatNominatimAddress(address: NominatimAddress) {
    const street = [address.road ?? address.pedestrian, address.house_number]
        .filter(Boolean)
        .join(' ')
    const place = [
        address.postcode,
        address.city ?? address.town ?? address.village,
    ]
        .filter(Boolean)
        .join(' ')
    return [street, place].filter(Boolean).join(', ')
}

export async function reverseGeocode([lat, lng]: [number, number]) {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.search = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
    }).toString()
    const response = await fetch(url)
    if (!response.ok) return null
    const hit = (await response.json()) as { address?: NominatimAddress }
    return (hit.address && formatNominatimAddress(hit.address)) || null
}
