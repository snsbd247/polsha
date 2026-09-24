import { useSearchParams } from 'react-router-dom'
import { Result, Spin, Tabs } from 'antd'
import { t as tx } from '../../lib/i18n'
import { useReportCatalog } from '../../lib/reports'
import ReportView from '../../components/ReportView'

/** A menu page made of one or more registry reports (tabs when more than one); only those the user may open are shown. */
export default function ReportPage({ title, keys, note }: { title: string; keys: string[]; note?: string }) {
  const { data: catalog, isLoading } = useReportCatalog()
  const [search, setSearch] = useSearchParams()
  const allowed = keys.filter((k) => catalog?.reports.some((r) => r.key === k))
  const active = allowed.includes(search.get('tab') ?? '') ? search.get('tab')! : allowed[0]

  return (
    <>
      <div className="page-header">
        <h2>{title}</h2>
      </div>
      {note && <p style={{ color: '#888' }}>{note}</p>}
      {isLoading ? (
        <Spin />
      ) : allowed.length === 0 ? (
        <Result status="403" title={tx('অনুমতি নেই')} subTitle={tx('এই রিপোর্ট দেখার অনুমতি আপনার নেই।')} />
      ) : allowed.length === 1 ? (
        <ReportView reportKey={allowed[0]} />
      ) : (
        <Tabs
          activeKey={active}
          onChange={(k) => setSearch({ tab: k }, { replace: true })}
          destroyOnHidden
          items={allowed.map((k) => ({
            key: k,
            label: catalog!.reports.find((r) => r.key === k)!.title,
            children: <ReportView reportKey={k} />,
          }))}
        />
      )}
    </>
  )
}
