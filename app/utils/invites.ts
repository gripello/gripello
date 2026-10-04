import type { InviteDetails } from '~/types/models'

export type InviteStep =
    'invalid' | 'join' | 'wrongAccount' | 'signIn' | 'register'

export function inviteStep(
    invite: InviteDetails | null | undefined,
    signedInEmail: string,
): InviteStep {
    if (!invite) return 'invalid'
    if (signedInEmail) {
        return signedInEmail.toLowerCase() === invite.email.toLowerCase()
            ? 'join'
            : 'wrongAccount'
    }
    return invite.hasAccount ? 'signIn' : 'register'
}
