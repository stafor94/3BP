from pathlib import Path

path = Path('src/physics/fragmentAwareEngine.ts')
source = path.read_text(encoding='utf-8')
old = """  const stellarOutcome = stepped.find((body) => (\n    body.bodyType === 'effect' &&\n    body.effectVisual?.stellarOutcome\n  ))?.effectVisual?.stellarOutcome\n  if (stellarOutcome === 'partialDisruption') return 'partialDisruption'\n"""
new = """  const stellarOutcome = stepped.find((body) => (\n    body.bodyType === 'effect' &&\n    body.name === COLLISION_FLASH_NAME &&\n    body.effectVisual?.stellarOutcome &&\n    (\n      body.id.startsWith(`${bodyA.id}+${bodyB.id}+flash`) ||\n      body.id.startsWith(`${bodyB.id}+${bodyA.id}+flash`)\n    )\n  ))?.effectVisual?.stellarOutcome\n  if (stellarOutcome === 'partialDisruption') return 'partialDisruption'\n"""
if source.count(old) != 1:
    raise RuntimeError(f'expected one outcome lookup, found {source.count(old)}')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
