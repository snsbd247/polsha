import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Card, Radio, Space, Spin, Table, Tag, Typography } from 'antd'
import { api, errorMessage } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { useFarmerMeta, type FarmerMeta } from '../../lib/phase2'
import { t as tx } from '../../lib/i18n'

type F = Record<string, unknown> & {
  id: number
  farmer_code: string
  name_bn: string
  documents_count: number
  village: { name_bn: string } | null
  mouza: { name_bn: string } | null
  member: { member_no: number } | null
  household: { code: string } | null
}

const LABELS: Record<string, string> = {
  name_bn: tx('নাম (বাংলা)'), name_en: tx('নাম (ইংরেজি)'), father_name: tx('পিতার নাম'), mother_name: tx('মাতার নাম'), spouse_name: tx('স্বামী/স্ত্রী'),
  gender: tx('লিঙ্গ'), date_of_birth: tx('জন্মতারিখ'), nid: 'NID', birth_reg_no: tx('জন্ম নিবন্ধন'), mobile: tx('মোবাইল'), alt_mobile: tx('বিকল্প মোবাইল'),
  photo: tx('ছবি'), village_id: tx('গ্রাম'), mouza_id: tx('মৌজা'), para: tx('পাড়া'), post_office: tx('ডাকঘর'), household_id: tx('খানা'),
  household_relation: tx('খানায় সম্পর্ক'), occupation: tx('পেশা'), remarks: tx('মন্তব্য'),
}

const CODED: Record<string, keyof FarmerMeta> = { gender: 'genders', household_relation: 'relations', occupation: 'occupations' }

function display(f: F, field: string, meta?: FarmerMeta): string {
  if (CODED[field] && f[field]) return meta?.[CODED[field]][String(f[field])] ?? String(f[field])
  if (field === 'village_id') return f.village?.name_bn ?? '—'
  if (field === 'mouza_id') return f.mouza?.name_bn ?? '—'
  if (field === 'household_id') return f.household?.code ?? '—'
  if (field === 'photo') return f.photo ? tx('আছে') : '—'
  if (field === 'date_of_birth') return fmtDate(f.date_of_birth as string | null)
  const v = f[field]
  return v === null || v === undefined || v === '' ? '—' : digits(String(v))
}

export default function MergePage() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [keepSide, setKeepSide] = useState<'a' | 'b'>('a')
  const [choices, setChoices] = useState<Record<string, 'a' | 'b'>>({})
  const [saving, setSaving] = useState(false)
  const { data: meta } = useFarmerMeta()

  const { data, isLoading, error } = useQuery({
    queryKey: ['farmer-compare', sp.get('a'), sp.get('b')],
    queryFn: async () => (await api.get<{ a: F; b: F; fields: string[] }>('/farmers/compare', { params: { a: sp.get('a'), b: sp.get('b') } })).data,
  })

  // Default: take each field from the kept record, or from the other one if the kept one is empty.
  const effective = useMemo(() => {
    if (!data) return {}
    const out: Record<string, 'a' | 'b'> = {}
    for (const field of data.fields) {
      const other = keepSide === 'a' ? 'b' : 'a'
      const keepEmpty = display(data[keepSide], field, meta) === '—'
      out[field] = choices[field] ?? (keepEmpty && display(data[other], field, meta) !== '—' ? other : keepSide)
    }
    return out
  }, [data, keepSide, choices, meta])

  if (isLoading) return <Spin />
  if (error || !data) return <Alert type="error" title={errorMessage(error)} />

  const bothMembers = !!data.a.member && !!data.b.member
  const keep = data[keepSide]
  const remove = data[keepSide === 'a' ? 'b' : 'a']

  const submit = async () => {
    setSaving(true)
    try {
      const mapped = Object.fromEntries(Object.entries(effective).map(([k, side]) => [k, side === keepSide ? 'keep' : 'remove']))
      const r = await api.post('/farmers-merge', { keep_id: keep.id, remove_id: remove.id, choices: mapped })
      message.success(r.data.message)
      navigate(r.data.status === 'approved' ? `/farmers/${keep.id}` : `/approvals/${r.data.approval_id}`)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const header = (side: 'a' | 'b') => {
    const f = data[side]
    return (
      <Space orientation="vertical" size={0}>
        <Radio checked={keepSide === side} onChange={() => setKeepSide(side)}>
          <strong>{tx('এটি রাখুন')}</strong>
        </Radio>
        <span>
          {f.farmer_code} {f.member && <Tag color="green">{tx('সদস্য নং')}{' '}{digits(f.member.member_no)}</Tag>}
        </span>
        <Typography.Text type="secondary">{tx('ডকুমেন্ট:')}{' '}{digits(f.documents_count)}{tx('টি')}</Typography.Text>
      </Space>
    )
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('কৃষক মার্জ')}</h2>
      </div>
      {bothMembers ? (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} title={tx('দুজনই সদস্য। মার্জের আগে একজনের সদস্যপদ বাতিল করতে হবে।')} />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={tx('কোন রেকর্ডটি থাকবে তা বাছাই করুন, এবং প্রতিটি তথ্য কোন রেকর্ড থেকে নেওয়া হবে তা ঠিক করুন। অন্য রেকর্ডের ডকুমেন্ট, সদস্যপদ ও আবেদন রাখা রেকর্ডে চলে যাবে। অনুমোদনের পর কার্যকর হবে।')}
        />
      )}
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="field"
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
          dataSource={data.fields.map((field) => ({ field }))}
          columns={[
            { title: tx('তথ্য'), dataIndex: 'field', width: 160, render: (f) => LABELS[f] ?? f },
            ...(['a', 'b'] as const).map((side) => ({
              title: header(side),
              render: (_: unknown, { field }: { field: string }) => {
                const same = display(data.a, field, meta) === display(data.b, field, meta)
                return (
                  <Radio
                    checked={effective[field] === side}
                    disabled={same}
                    onChange={() => setChoices((c) => ({ ...c, [field]: side }))}
                    style={{ opacity: same && side === 'b' ? 0.5 : 1 }}
                  >
                    <span className={!same && effective[field] === side ? 'diff-new' : undefined}>{display(data[side], field, meta)}</span>
                  </Radio>
                )
              },
            })),
          ]}
        />
      </Card>
      <Space style={{ marginTop: 16 }}>
        <Button type="primary" danger disabled={bothMembers} loading={saving} onClick={submit}>
          {remove.farmer_code} → {keep.farmer_code}{' '}{tx('মার্জের অনুরোধ পাঠান')}
        </Button>
        <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
      </Space>
    </>
  )
}
