import type { Language } from './i18n'
import type { StellarEvolutionStage } from './types'

export const STAGE_LABELS: Record<Language, Record<StellarEvolutionStage, string>> = {
  ko: {
    protostar: '원시성',
    mainSequence: '주계열성',
    subgiant: '준거성',
    giant: '거성',
    supergiant: '초거성',
    whiteDwarf: '백색왜성',
  },
  en: {
    protostar: 'Protostar',
    mainSequence: 'Main sequence',
    subgiant: 'Subgiant',
    giant: 'Giant',
    supergiant: 'Supergiant',
    whiteDwarf: 'White dwarf',
  },
}

