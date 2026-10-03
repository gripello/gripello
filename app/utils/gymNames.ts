type NamedGym = { name?: string | null; unit_name?: string | null }

export const gymTitle = (gym: NamedGym) => gym.unit_name || gym.name || ''

export const gymSubtitle = (gym: NamedGym) =>
    gym.unit_name && gym.name !== gym.unit_name ? (gym.name ?? '') : ''

export function landingSections<T extends { slug: string }>(
    gyms: T[],
    mySlugs: (string | undefined)[],
    recentSlugs: string[],
) {
    const shown = new Set<string>()
    const pick = (slugs: (string | undefined)[]) =>
        slugs.flatMap((slug) => {
            const gym = gyms.find((entry) => entry.slug === slug)
            if (!gym || shown.has(gym.slug)) return []
            shown.add(gym.slug)
            return [gym]
        })
    return [
        { key: 'my-gyms', title: 'landing.myGyms', gyms: pick(mySlugs) },
        { key: 'recent', title: 'landing.recent', gyms: pick(recentSlugs) },
        {
            key: 'all-gyms',
            title: 'landing.allGyms',
            gyms: pick(gyms.map((gym) => gym.slug)),
        },
    ].filter((section) => section.gyms.length)
}
