import { readFileSync } from 'node:fs'

describe('scan page', () => {
    it('sizes the frame by the camera height on landscape phones', () => {
        const source = readFileSync('app/pages/scan.vue', 'utf8')
        expect(source).toMatch(
            /@variant short-landscape \{\s+\.scan-viewport \{\s+min-height: 0;\s+\}\s+\.scan-frame \{\s+width: auto;\s+height: 70%;/,
        )
    })
})
