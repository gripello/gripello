import type { ServerIssue, ServerReplica } from '~/api/platform'

export function issueTitle(issue: Pick<ServerIssue, 'message' | 'sample'>) {
    const route = issue.sample?.route
    const error = issue.sample?.error
    return [issue.message, route, error]
        .filter((part) => typeof part === 'string' && part)
        .join(' · ')
}

export type ReplicaStrain = 'dbWaits' | 'realtimeDropped' | 'busLag' | 'dbFull'

// Same thresholds as the warnings the replicas log (replicas.warnIfStrained), plus a pool that is fully in use.
export function replicaStrain(server: ServerReplica): ReplicaStrain[] {
    if (!server.online) return []
    const strain: ReplicaStrain[] = []
    if (server.db_wait_ms > 1000) strain.push('dbWaits')
    if (server.db_conns_max && server.db_conns_in_use >= server.db_conns_max)
        strain.push('dbFull')
    if (server.realtime_dropped > 0) strain.push('realtimeDropped')
    if (server.bus_lag_ms > 10_000) strain.push('busLag')
    return strain
}
