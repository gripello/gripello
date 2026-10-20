export const liveTopics = {
    openDefects: 'open_route_defects',
    ownTicks: 'own_ticks',
    ownNotifications: 'own_notifications',
    followedTicks: 'followed_ticks',
    followChanges: 'follow_changes',
    climbers: 'climbers',
    settings: 'settings',
    platform: 'platform',
    platformModeration: 'moderation:platform',
    auditLogs: 'audit_logs',
    pushSubscriptions: 'push_subscriptions',
} as const

export const gymChangesTopic = (gymId: string) => `gym_changes:${gymId}`

export const gymDefectsTopic = (gymId: string) =>
    `${liveTopics.openDefects}:${gymId}`

export const gymTopic = (gymId: string) => `gym:${gymId}`

export const userTopic = (userId: string) => `user:${userId}`

export const tasksTopic = (gymId: string) => `tasks:${gymId}`

export const moderationTopic = (gymIdOrPlatform: string) =>
    `moderation:${gymIdOrPlatform}`

export const leaderboardTopic = (gymId: string) =>
    gymId ? `leaderboard:${gymId}` : null

export const competitionTopic = (competitionId: string) =>
    `competition_changes:${competitionId}`

export const gymCompetitionsTopic = (gymId: string) =>
    gymId ? `competitions:${gymId}` : null
