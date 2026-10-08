import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    directionLinks,
    formatNominatimAddress,
    geocodeAddress,
    gymContacts,
    gymMarkers,
    hasGymInfo,
    hasLocation,
    preferredDirections,
    reverseGeocode,
} from '../../app/utils/gymInfo'

const gym = {
    id: 'g1',
    slug: 'boulderhaus',
    name: 'Boulderhaus',
    latitude: 52.52,
    longitude: 13.405,
    address: 'Hauptstr. 1\n10115 Berlin',
}

describe('gymInfo', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('treats PocketBase zero coordinates as no location', () => {
        expect(hasLocation({ latitude: 0, longitude: 0 })).toBe(false)
        expect(hasLocation(gym)).toBe(true)
    })

    it('links directions to the coordinates', () => {
        const links = Object.fromEntries(
            directionLinks(gym).map((link) => [link.key, link.href]),
        )
        expect(links.google).toBe(
            'https://www.google.com/maps/dir/?api=1&destination=52.52,13.405',
        )
        expect(links.osm).toContain('mlat=52.52&mlon=13.405')
        expect(links.apple).toContain('daddr=52.52,13.405')
    })

    it('opens the native maps app of the device', () => {
        expect(
            preferredDirections(
                gym,
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
            ),
        ).toContain('maps.apple.com')
        expect(
            preferredDirections(gym, 'Mozilla/5.0 (Linux; Android 15)'),
        ).toBe('geo:52.52,13.405?q=52.52,13.405')
        expect(
            preferredDirections(gym, 'Mozilla/5.0 (X11; Linux x86_64)'),
        ).toContain('google.com/maps/dir')
    })

    it('puts only located gyms on the map with their hall name and logo', () => {
        expect(
            gymMarkers(
                [
                    { ...gym, unit_name: 'Kletterzentrum' },
                    { ...gym, id: 'g2', latitude: 0, longitude: 0 },
                ],
                (g) => `/logo/${g.id}.png`,
            ),
        ).toEqual([
            {
                id: 'g1',
                lat: 52.52,
                lng: 13.405,
                label: 'Kletterzentrum',
                logo: '/logo/g1.png',
            },
        ])
    })

    it('lists phone, e-mail and website as links', () => {
        expect(
            gymContacts({
                legal_phone: '+49 (0) 69 123',
                contact_email: 'info@gym.test',
                website_url: 'https://www.gym.test',
            }).map((c) => [c.key, c.label, c.href]),
        ).toEqual([
            ['phone', '+49 (0) 69 123', 'tel:+49069123'],
            ['email', 'info@gym.test', 'mailto:info@gym.test'],
            ['website', 'gym.test', 'https://www.gym.test'],
        ])
    })

    it('detects whether a gym has any public info', () => {
        expect(hasGymInfo({ name: 'x', latitude: 0, longitude: 0 })).toBe(false)
        expect(hasGymInfo({ amenities: ['showers'] })).toBe(true)
        expect(
            hasGymInfo({ opening_hours: { mon: [['07:00', '23:00']] } }),
        ).toBe(true)
    })

    it('geocodes an address on one line through Nominatim', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify([{ lat: '52.5', lon: '13.4' }])),
            )
        vi.stubGlobal('fetch', fetch)
        expect(await geocodeAddress(gym.address)).toEqual([52.5, 13.4])
        expect(String(fetch.mock.calls[0]![0])).toContain(
            'q=Hauptstr.+1%2C+10115+Berlin',
        )
    })

    it('returns null when nothing is found', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]')))
        expect(await geocodeAddress('nowhere')).toBeNull()
    })
})

describe('reverseGeocode', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('formats street, postcode and city from Nominatim', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        address: {
                            road: 'Hauptstraße',
                            house_number: '1',
                            postcode: '10115',
                            city: 'Berlin',
                            country: 'Deutschland',
                        },
                    }),
                ),
            ),
        )
        expect(await reverseGeocode([52.5, 13.4])).toBe(
            'Hauptstraße 1, 10115 Berlin',
        )
    })

    it('falls back to the town and skips missing parts', () => {
        expect(formatNominatimAddress({ town: 'Bad Tölz' })).toBe('Bad Tölz')
        expect(formatNominatimAddress({})).toBe('')
    })
})
