export type AdminUsersTab = 'members' | 'roles'

export function adminUsersTabFromHash(hash: string): AdminUsersTab {
    return hash === '#roles' ? 'roles' : 'members'
}

export function adminUsersTabHash(tab: AdminUsersTab) {
    return tab === 'roles' ? '#roles' : ''
}

export function withSelectedRole<T extends Record<string, unknown>>(
    query: T,
    roleId: string | null,
) {
    const { role: _role, ...rest } = query
    return roleId ? { ...rest, role: roleId } : rest
}
