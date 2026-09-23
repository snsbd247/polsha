import { Segmented } from 'antd'
import { api } from '../lib/api'
import { lang, setLang, type Lang } from '../lib/i18n'

/** বাংলা / English switch. Saves to the profile when signed in, then reloads. */
export default function LanguageToggle({ signedIn = false }: { signedIn?: boolean }) {
  const change = async (next: Lang) => {
    if (signedIn) {
      try {
        await api.post('/me/locale', { locale: next })
      } catch {
        /* still switch locally */
      }
    }
    setLang(next)
  }

  return (
    <Segmented<Lang>
      size="small"
      value={lang}
      onChange={change}
      options={[
        { label: 'বাংলা', value: 'bn' },
        { label: 'English', value: 'en' },
      ]}
      aria-label="Language / ভাষা"
    />
  )
}
