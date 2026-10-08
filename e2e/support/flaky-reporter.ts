import fs from 'node:fs'
import path from 'node:path'
import type { Reporter, Suite } from '@playwright/test/reporter'

const OUTPUT = path.join(import.meta.dirname, '..', 'results', 'flaky.txt')

export default class FlakyReporter implements Reporter {
    private root?: Suite

    onBegin(_config: unknown, suite: Suite) {
        this.root = suite
    }

    onEnd() {
        const flaky = (this.root?.allTests() ?? [])
            .filter((test) => test.outcome() === 'flaky')
            .map(
                (test) =>
                    `${test.parent.project()?.name} › ${path.relative(process.cwd(), test.location.file)}:${test.location.line} › ${test.title}`,
            )
        fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
        fs.writeFileSync(OUTPUT, flaky.map((line) => `${line}\n`).join(''))
    }
}
