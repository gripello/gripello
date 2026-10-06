import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('the profile avatar upload opens with the keyboard', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account/settings')

    const upload = page.getByTestId('profile-avatar-upload')
    await expect(upload).toHaveRole('button')
    await expect(upload).toHaveAttribute('aria-label', /.+/)

    await upload.focus()
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    await chooser
})

const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
)

test('an uploaded avatar is shown in the user menu', async ({
    root,
    createUser,
    pageAs,
}) => {
    const user = await createUser('user')
    const form = new FormData()
    form.append(
        'avatar',
        new Blob([ONE_PIXEL_PNG], { type: 'image/png' }),
        'a.png',
    )
    await root.collection('users').update(user.id, form)
    const page = await pageAs(user)

    await gotoSettled(page, '/account')
    const avatar = page.getByTestId('user-menu-activator').locator('img')
    await expect(avatar).toHaveAttribute('src', /\/api\/files\//)
    await expect
        .poll(() =>
            avatar.evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0)
})
