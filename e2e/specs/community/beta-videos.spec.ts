import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'

test('a climber shares and removes a beta link', async ({
    page,
    createUser,
    route,
}) => {
    const climber = await createUser('user', 'beta')
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, `/route?id=${route.id}`)

    await page.getByTestId('beta-add').click()
    await page.getByTestId('beta-link').fill('https://example.com/video')
    await expect(page.getByTestId('beta-submit')).toBeDisabled()
    await page.getByTestId('beta-link').fill('https://youtu.be/e2e-beta')
    await expect(page.getByTestId('beta-submit')).toBeDisabled()
    await page
        .getByTestId('beta-link')
        .fill('https://youtube.com/shorts/e2e-beta')
    await page.getByTestId('beta-submit').click()

    const link = page.getByTestId('beta-list').getByTestId('beta-video-link')
    await expect(link).toHaveAttribute(
        'href',
        'https://youtube.com/shorts/e2e-beta',
    )
    await expect(link).toContainText('YouTube')
    await expect(page.getByTestId('beta-video-author')).toHaveAttribute(
        'href',
        `/climber?id=${climber.id}`,
    )

    await page.getByTestId('beta-video-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(link).toHaveCount(0)
})

test('only the uploader deletes a beta, everyone else reports it', async ({
    page,
    adminPage,
    root,
    createUser,
    route,
}) => {
    const owner = await createUser('user', 'owner')
    const video = await root.collection('beta_videos').create({
        user: owner.id,
        route: route.id,
        url: 'https://youtube.com/shorts/123',
    })

    await gotoSettled(adminPage, `/route?id=${route.id}#beta-${video.id}`)
    const foreign = adminPage.getByTestId(`beta-video-${video.id}`)
    await expect(foreign.getByTestId('beta-video-report')).toBeVisible()
    await expect(foreign.getByTestId('beta-video-delete')).toHaveCount(0)

    await signInAs(page, owner.email, owner.password)
    await gotoSettled(page, '/e2e/feed')
    const own = page
        .getByTestId('feed-betas')
        .getByTestId(`beta-video-${video.id}`)
    await expect(own.getByTestId('beta-video-report')).toHaveCount(0)
    await own.getByTestId('beta-video-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(own).toHaveCount(0)
})

test('archived routes take no new beta', async ({
    page,
    createUser,
    createRoute,
}) => {
    const climber = await createUser('user', 'late')
    const archived = await createRoute({ archived: true })
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, `/route?id=${archived.id}`)
    await expect(page.getByTestId('route-reviews')).toBeVisible()
    await expect(page.getByTestId('beta-add')).toHaveCount(0)
})

test('a picked video is previewed before sharing', async ({
    page,
    createUser,
    route,
}) => {
    const climber = await createUser('user', 'preview')
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, `/route?id=${route.id}`)

    await page.getByTestId('beta-add').click()
    await page.getByTestId('beta-source').getByText('Video').click()
    await page.getByTestId('beta-file').setInputFiles({
        name: 'beta.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from('not really a video'),
    })
    await expect(page.getByTestId('beta-file-preview')).toBeVisible()
    await expect(page.getByTestId('beta-dialog')).toContainText('beta.mp4')
    await expect(page.getByTestId('beta-submit')).toBeEnabled()
})
