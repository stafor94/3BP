import { translations, type Language } from '../i18n'
import type { BodyState, BodyType } from '../types'
import '../body-type-controls.css'

type EditableBodyType = Extract<BodyType, 'star' | 'planet' | 'moon'>

const EDITABLE_BODY_TYPES: EditableBodyType[] = ['star', 'planet', 'moon']

function isEditableBodyType(type: BodyType | undefined): type is EditableBodyType {
  return type === 'star' || type === 'planet' || type === 'moon'
}

type Props = {
  body: BodyState
  language: Language
  onChange: (next: BodyState) => void
}

export function BodyTypeSelector({ body, language, onChange }: Props) {
  const t = translations[language]
  const editableType = isEditableBodyType(body.bodyType) ? body.bodyType : null
  const displayedType = body.bodyType ?? 'planet'
  const hint = editableType === 'star'
    ? t.selfLuminousHint
    : editableType
      ? t.reflectedLightHint
      : t.transientBodyHint

  return (
    <div className="body-type-row">
      <span>
        <strong>{t.bodyType}</strong>
        <small title={hint}>{hint}</small>
      </span>
      <select
        value={displayedType}
        disabled={!editableType}
        aria-label={`${body.name} ${t.bodyType}`}
        onChange={(event) => onChange({ ...body, bodyType: event.target.value as EditableBodyType })}
      >
        {editableType ? (
          EDITABLE_BODY_TYPES.map((type) => <option key={type} value={type}>{t[type]}</option>)
        ) : (
          <option value={displayedType}>{t[displayedType]}</option>
        )}
      </select>
    </div>
  )
}
