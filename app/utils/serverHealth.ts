import type { ServerIssue } from '~/api/platform'

export function issueTitle(issue: Pick<ServerIssue, 'message' | 'sample'>) {
    const route = issue.sample?.route
    const error = issue.sample?.error
    return [issue.message, route, error]
        .filter((part) => typeof part === 'string' && part)
        .join(' · ')
}
