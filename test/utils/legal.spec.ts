import { legalLinkProps } from '~/utils/legal'

describe('legalLinkProps', () => {
    it('opens only external pages in a new window', () => {
        expect(
            legalLinkProps('https://example.com/privacy', '/e2e/privacy'),
        ).toEqual({
            href: 'https://example.com/privacy',
            target: '_blank',
            rel: 'noopener noreferrer',
        })
        expect(legalLinkProps('', '/e2e/privacy')).toEqual({
            to: '/e2e/privacy',
        })
    })
})
