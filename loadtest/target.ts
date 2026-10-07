import PocketBase from 'pocketbase'

export const BASE_URL = process.env.BASE_URL || 'https://localhost'

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']

if (
    !LOCAL_HOSTS.includes(new URL(BASE_URL).hostname) &&
    process.env.LOADTEST_ALLOW_REMOTE !== '1'
) {
    throw new Error(
        `Refusing to touch ${BASE_URL}; set LOADTEST_ALLOW_REMOTE=1 to target a remote instance.`,
    )
}

export async function superuserClient() {
    const pb = new PocketBase(BASE_URL)
    pb.autoCancellation(false)
    await pb
        .collection('_superusers')
        .authWithPassword(
            process.env.PB_SUPERUSER_EMAIL!,
            process.env.PB_SUPERUSER_PASSWORD!,
        )
    return pb
}
