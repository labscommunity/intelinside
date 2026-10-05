import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { ApiError } from './types.js'

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })

/** Shared by browser forms and the authenticated HTTP API. */
export function moderateText(entries: Array<[field: string, value: string | null | undefined, maxLength: number]>) {
  const fields: Record<string, string> = {}
  for (const [field, value, maxLength] of entries) {
    if (!value) continue
    if (value.length > maxLength) fields[field] = `Use ${maxLength} characters or fewer.`
    else if (matcher.hasMatch(value)) fields[field] = 'Please remove offensive or profane language.'
  }
  if (Object.keys(fields).length) throw new ApiError('moderation_rejected', 'Please revise the highlighted text.', 400, fields)
}
