import translations from './twin-copy.json'

type CopyData = { copy: Record<string, Record<string, string>> }
const copy = (translations as CopyData).copy

/** Translate viewer chrome only. Labels and assertions from .mith remain source data. */
export function twinCopy(locale: string, english: string, values: Record<string, string | number> = {}): string {
  const message = copy[locale]?.[english] ?? english
  return message.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match)
}
