import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

const version = packageJson.version
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`package.json version must use MAJOR.MINOR.PATCH: ${version}`)
}

const releaseHeadings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)]
if (releaseHeadings.length === 0) {
  throw new Error('CHANGELOG.md has no release headings')
}

const latestChangelogVersion = releaseHeadings[0][1]
if (latestChangelogVersion !== version) {
  throw new Error(
    `release version mismatch: package.json=${version}, CHANGELOG latest=${latestChangelogVersion}`,
  )
}

console.log(`versioning regression passed (${version})`)
