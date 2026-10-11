import { createGym, deleteGym, getGym } from '../../support/api'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('platform admin turns beta videos on for one gym', async ({
    platformPage: page,
    api,
}) => {
    const slug = `e2e-ff-${Date.now()}`
    const gym = await createGym(api, { slug, name: 'E2E Flags', active: true })
    try {
        await gotoSettled(page, `/platform/gyms/${gym.id}?section=features`)
        const toggle = page.getByTestId(`platform-feature-${slug}-beta_videos`)
        await expect(toggle).toHaveAttribute('aria-checked', 'false')
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-checked', 'true')
        await expect
            .poll(async () => (await getGym(api, gym.id)).features)
            .toEqual({ beta_videos: true })
    } finally {
        await deleteGym(api, gym.id)
    }
})
