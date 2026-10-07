// Mirrored in pocketbase/pb_migrations/1792800001_gym_info.js.
export const GYM_AMENITIES = {
    toilets: 'i-lucide-toilet',
    showers: 'i-lucide-shower-head',
    changing_rooms: 'i-lucide-shirt',
    lockers: 'i-lucide-lock',
    cafe: 'i-lucide-coffee',
    shop: 'i-lucide-shopping-bag',
    rental: 'i-lucide-footprints',
    parking: 'i-lucide-square-parking',
    bike_parking: 'i-lucide-bike',
    public_transport: 'i-lucide-tram-front',
    kids_area: 'i-lucide-baby',
    training_area: 'i-lucide-dumbbell',
    outdoor_area: 'i-lucide-trees',
    yoga: 'i-lucide-flower-2',
    sauna: 'i-lucide-thermometer-sun',
    wheelchair: 'i-lucide-accessibility',
    wifi: 'i-lucide-wifi',
} as const

export type GymAmenity = keyof typeof GYM_AMENITIES

export const GYM_AMENITY_KEYS = Object.keys(GYM_AMENITIES) as GymAmenity[]
