import { readFileSync, writeFileSync } from 'node:fs'

const path = 'scripts/physicsRegression.ts'
let source = readFileSync(path, 'utf8')

function replaceOnce(before, after) {
  const index = source.indexOf(before)
  if (index < 0) throw new Error(`Missing regression patch target: ${before.slice(0, 120)}`)
  if (source.indexOf(before, index + before.length) >= 0) throw new Error('Regression patch target is not unique')
  source = source.slice(0, index) + after + source.slice(index + before.length)
}

replaceOnce(
`  assert(\n    contactFrames >= 25,\n    'contact must remain visible for most of the 0.045 simulated-second impact window',\n  )\n`,
`  assert(\n    contactFrames >= 2 && contactFrames <= 4,\n    'ordinary impact staging must remain a short contact bridge instead of a long simulated-time hold',\n  )\n`,
)

replaceOnce(
`  assert(\n    contactFrames >= 72,\n    'stellar merge should preserve both original stars for most of the 0.12 simulated-second absorption window',\n  )\n  assert(\n    deepestOverlap >= minRadius * 1.5,\n    'stellar merge should reach at least 150% of the smaller-star radius before resolving',\n  )\n  assert(\n    deepestOverlap <= minRadius * 1.601,\n    'stellar merge display staging must not exceed the configured 160% overlap target',\n  )\n`,
`  assert(\n    contactFrames >= 4 && contactFrames <= 6,\n    'stellar merge staging must stay within the short contact bridge before physical resolution',\n  )\n  assert(\n    deepestOverlap >= minRadius * 0.25,\n    'stellar merge contact bridge must still show visible compression before resolving',\n  )\n  assert(\n    deepestOverlap <= minRadius * 0.341,\n    'stellar merge display staging must not exceed the configured 34% overlap target',\n  )\n`,
)

writeFileSync(path, source, 'utf8')
console.log('collision bridge regression updated')
