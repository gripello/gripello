import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const jenkinsfile = readFileSync('Jenkinsfile', 'utf8')
const SKIPPABLE = /when \{ expression \{ env\.SKIP_TESTS != 'true' \} \}/

const stageHead = (name: string) =>
    jenkinsfile.slice(
        jenkinsfile.indexOf(`stage('${name}') {`),
        jenkinsfile.indexOf(`stage('${name}') {`) + 200,
    )

describe('release builds', () => {
    it('skips tests only for a version bump right after a green build of its parent', () => {
        expect(jenkinsfile).toContain(
            "def onlyVersionBump = sh(script: 'git diff --name-only HEAD~1 || true', returnStdout: true).trim() == 'package.json'",
        )
        expect(jenkinsfile).toContain(
            "def parentPassed = currentBuild.previousBuild?.result == 'SUCCESS' && builtCommits(currentBuild.changeSets) == [head]",
        )
        expect(jenkinsfile).toContain(
            'env.SKIP_TESTS = (isReleaseCommit && onlyVersionBump && parentPassed).toString()',
        )
    })

    it.each(['Vitest', 'Go Tests', 'Build Image', 'E2E Install', 'E2E Tests'])(
        'lets %s be skipped',
        (name) => expect(stageHead(name)).toMatch(SKIPPABLE),
    )

    it.each(['Typecheck', 'Android', 'Push Image', 'Play Store'])(
        'always runs %s',
        (name) => expect(stageHead(name)).not.toMatch(SKIPPABLE),
    )
})
