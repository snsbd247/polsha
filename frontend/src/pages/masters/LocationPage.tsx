import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, Empty, Form, Input, Modal, Row, Spin, Switch, Tag, Typography } from 'antd'
import { EditOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { required } from '../../lib/rules'
import type { LocationItem } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

const LEVELS = [
  { key: 'divisions', label: tx('বিভাগ'), parentKey: null },
  { key: 'districts', label: tx('জেলা'), parentKey: 'division_id' },
  { key: 'upazilas', label: tx('উপজেলা'), parentKey: 'district_id' },
  { key: 'unions', label: tx('ইউনিয়ন'), parentKey: 'upazila_id' },
  { key: 'villages', label: tx('গ্রাম'), parentKey: 'union_id' },
] as const

type Level = (typeof LEVELS)[number]

function LevelColumn({
  level,
  parentId,
  selectedId,
  onSelect,
  onEdit,
}: {
  level: Level
  parentId: number | null
  selectedId: number | null
  onSelect: (item: LocationItem) => void
  onEdit: (level: Level, item: LocationItem | null) => void
}) {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const enabled = level.parentKey === null || parentId !== null

  const { data, isLoading } = useQuery({
    queryKey: ['locations', level.key, parentId],
    queryFn: async () => (await api.get<LocationItem[]>(`/locations/${level.key}`, { params: { parent_id: parentId ?? undefined } })).data,
    enabled,
  })

  const items = (data ?? []).filter((i) => !search || i.name_bn.includes(search) || i.name_en?.toLowerCase().includes(search.toLowerCase()))
  const isLeaf = level.key === 'villages'

  return (
    <Card
      size="small"
      title={level.label}
      extra={
        can('location.create') &&
        enabled && <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => onEdit(level, null)} aria-label={tx('নতুন {{p0}}', { p0: level.label })} />
      }
      styles={{ body: { padding: 0, height: 420, overflow: 'auto' } }}
    >
      {!enabled ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('বাম পাশ থেকে বাছাই করুন')} style={{ marginTop: 60 }} />
      ) : (
        <>
          <div style={{ padding: 8 }}>
            <Input size="small" placeholder={tx('খুঁজুন')} allowClear value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {isLoading ? (
            <Spin style={{ display: 'block', marginTop: 40 }} />
          ) : items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('কিছু নেই')} />
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`loc-item${item.id === selectedId ? ' is-selected' : ''}${isLeaf ? ' is-leaf' : ''}`}
                role={isLeaf ? undefined : 'button'}
                tabIndex={isLeaf ? undefined : 0}
                onClick={() => !isLeaf && onSelect(item)}
                onKeyDown={(e) => !isLeaf && e.key === 'Enter' && onSelect(item)}
              >
                <span style={{ flex: 1, opacity: item.is_active ? 1 : 0.5 }}>
                  {item.name_bn} {!item.is_active && <Tag>{tx('নিষ্ক্রিয়')}</Tag>}
                </span>
                {can('location.edit') && (
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    aria-label={tx('সম্পাদনা')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(level, item)
                    }}
                  />
                )}
                {!isLeaf && <RightOutlined style={{ fontSize: 10, color: '#999' }} />}
              </div>
            ))
          )}
        </>
      )}
    </Card>
  )
}

export default function LocationPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [path, setPath] = useState<(number | null)[]>([null, null, null, null])
  const [editing, setEditing] = useState<{ level: Level; item: LocationItem | null } | null>(null)
  const [form] = Form.useForm()

  const select = (depth: number, item: LocationItem) =>
    setPath((p) => p.map((v, i) => (i < depth ? v : i === depth ? item.id : null)))

  const parentOf = (levelIndex: number) => (levelIndex === 0 ? null : path[levelIndex - 1])

  const openEdit = (level: Level, item: LocationItem | null) => {
    setEditing({ level, item })
    form.setFieldsValue(item ?? { name_bn: '', name_en: '', code: '', is_active: true })
  }

  const save = async () => {
    const values = await form.validateFields()
    const { level, item } = editing!
    const idx = LEVELS.indexOf(level)
    const payload = { ...values, ...(level.parentKey && !item ? { [level.parentKey]: parentOf(idx) } : {}) }
    try {
      if (item) await api.put(`/locations/${level.key}/${item.id}`, payload)
      else await api.post(`/locations/${level.key}`, payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['locations', level.key] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('এলাকা')}</h2>
      </div>
      <Typography.Paragraph type="secondary">
        {tx('বিভাগ → জেলা → উপজেলা → ইউনিয়ন → গ্রাম। বিভাগ ও জেলা আগে থেকেই যোগ করা আছে; সমিতির এলাকার উপজেলা, ইউনিয়ন ও গ্রাম যোগ করুন।')}
      </Typography.Paragraph>
      <Row gutter={[12, 12]}>
        {LEVELS.map((level, i) => (
          <Col key={level.key} xs={24} sm={12} lg={8} xl={Math.floor(24 / 5)} style={{ flex: '1 1 0' }}>
            <LevelColumn
              level={level}
              parentId={parentOf(i)}
              selectedId={i < 4 ? path[i] : null}
              onSelect={(item) => select(i, item)}
              onEdit={openEdit}
            />
          </Col>
        ))}
      </Row>
      <Modal
        open={!!editing}
        title={editing ? `${editing.level.label} ${editing.item ? tx('সম্পাদনা') : tx('যোগ করুন')}` : ''}
        onCancel={() => setEditing(null)}
        onOk={save}
        okText={tx('সংরক্ষণ')}
        cancelText={tx('বাতিল')}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
            <Input />
          </Form.Item>
          <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label={tx('সরকারি কোড (BBS, ঐচ্ছিক)')}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
            <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
