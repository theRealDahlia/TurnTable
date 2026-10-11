import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '../src/shared/app'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('app name', () => {
  it('is Muze', () => {
    expect(APP_NAME).toBe('Muze')
  })

  it.each(['src/renderer/index.html', 'src/renderer/spotify-player.html', 'src/renderer/youtube-player.html'])('is the name in the title of %s', (file) => {
    expect(read(file)).toMatch(/<title>Muze\b/)
  })

  it('does not leave the old name in anything the user can see', () => {
    for (const file of ['src/renderer/index.html', 'src/renderer/spotify-player.html', 'src/renderer/youtube-player.html', 'src/renderer/src/components/Sidebar.tsx', 'src/main/index.ts']) {
      expect(read(file)).not.toMatch(/['">]TurnTable\b/)
    }
  })
})
