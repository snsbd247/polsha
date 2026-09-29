import { loadDictionary } from './lib/i18n'

// Many modules build their labels when first imported, so the English
// dictionary (fetched only in English mode) must be in place before the app loads.
loadDictionary().then(() => import('./boot'))
