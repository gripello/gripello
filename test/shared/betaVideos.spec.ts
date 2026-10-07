import { describe, expect, it } from 'vitest'
import {
    betaPlatformIcon,
    betaVideoPlatform,
    videoClock,
} from '#shared/utils/betaVideos'

describe('betaVideoPlatform', () => {
    it('names the platforms the server accepts', () => {
        expect(betaVideoPlatform('https://youtube.com/shorts/1')).toBe(
            'YouTube',
        )
        expect(betaVideoPlatform('https://m.youtube.com/shorts/1')).toBe(
            'YouTube',
        )
        expect(betaVideoPlatform('https://www.instagram.com/reel/a')).toBe(
            'Instagram',
        )
        expect(betaVideoPlatform('https://vm.tiktok.com/a')).toBe('TikTok')
    })

    it('rejects other hosts, plain http and garbage', () => {
        expect(betaVideoPlatform('http://youtube.com/watch?v=a')).toBeNull()
        expect(betaVideoPlatform('https://youtube.com.evil.example')).toBeNull()
        expect(betaVideoPlatform('https://example.com/a.mp4')).toBeNull()
        expect(betaVideoPlatform('youtube')).toBeNull()
        expect(
            betaVideoPlatform('https://www.youtube.com/watch?v=a'),
        ).toBeNull()
        expect(betaVideoPlatform('https://youtu.be/a')).toBeNull()
        expect(betaVideoPlatform('https://vimeo.com/1')).toBeNull()
    })
})

describe('betaPlatformIcon', () => {
    it('picks the platform logo or the fallback', () => {
        expect(betaPlatformIcon('https://vm.tiktok.com/a', 'x')).toBe(
            'i-simple-icons-tiktok',
        )
        expect(betaPlatformIcon('https://example.com', 'x')).toBe('x')
    })
})

describe('videoClock', () => {
    it('formats playback time as minutes and seconds', () => {
        expect(videoClock(0)).toBe('0:00')
        expect(videoClock(7.9)).toBe('0:07')
        expect(videoClock(83)).toBe('1:23')
        expect(videoClock(Number.NaN)).toBe('0:00')
    })
})
