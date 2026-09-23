import { Link } from 'react-router-dom'
import { Table, Tag } from 'antd'
import { digits } from '../lib/format'
import { MATCH_LABEL, type DuplicateMatch } from '../lib/phase2'

export default function DuplicateMatches({ matches }: { matches: DuplicateMatch[] }) {
  return (
    <Table<DuplicateMatch>
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={matches}
      scroll={{ x: 560 }}
      columns={[
        { title: 'Farmer ID', dataIndex: 'farmer_code', render: (v, m) => <Link to={`/farmers/${m.id}`} target="_blank">{v}</Link> },
        { title: 'নাম', dataIndex: 'name_bn' },
        { title: 'পিতা', dataIndex: 'father_name' },
        { title: 'গ্রাম', dataIndex: 'village' },
        { title: 'মোবাইল', dataIndex: 'mobile', render: (v) => digits(v) || '—' },
        { title: 'মিলেছে', dataIndex: 'matched', render: (m: string[]) => m.map((k) => <Tag key={k} color="orange">{MATCH_LABEL[k] ?? k}</Tag>) },
      ]}
    />
  )
}
