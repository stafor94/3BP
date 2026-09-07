import sys,json
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'scripts'))
import stellarPhotographicVisualRegression as p
p.OUT=Path('stellar-radial-artifacts')
revision=sys.argv[1]
p.OUT.mkdir(exist_ok=True)
old=json.loads(Path('scripts/fixtures/stellar-radial-baseline.json').read_text())
driver=p.base.make_driver()
result={}
try:
 p.production.configure_production_storage(driver,p.base.CURRENT_URL)
 for star in p.STARS:
  scene,ui,state=p.capture(driver,p.base.CURRENT_URL,revision,star,'normal',0)
  geo=old['metrics']['reference'][star]['normal']['geometry']
  metric=p.analyze(scene,geo)
  for key in ['cameraPosition','controlsTarget','trackedBodyRadius','simulationTime']:
   assert state[key]==old['telemetry']['after'][star]['normal'][key],(star,key)
  p.validate(metric,old['metrics']['reference'][star]['normal'],star)
  p.validate_soft_transition(metric,old['metrics']['before'][star]['normal'],star)
  result[star]={'metric':metric,'telemetry':state}
  print(revision,star,'captured',flush=True)
finally:
 driver.quit()
 (p.OUT/f'{revision}-metrics.json').write_text(json.dumps(result,indent=2))
