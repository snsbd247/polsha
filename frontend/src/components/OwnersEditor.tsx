import { Button, Col, Form, InputNumber, Row, Tag } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import FarmerPicker from './FarmerPicker'
import { digits } from '../lib/format'
import { t as tx } from '../lib/i18n'

type Owner = { farmer_id?: number; share_percent?: number; label?: string }

/** Form.List of owners with a running share total; name must be "owners". */
export default function OwnersEditor({ name = 'owners' }: { name?: string }) {
  const form = Form.useFormInstance()
  const owners: Owner[] = Form.useWatch(name, form) ?? []
  const total = owners.reduce((s, o) => s + (Number(o?.share_percent) || 0), 0)
  const chosen = owners.map((o) => o?.farmer_id).filter(Boolean) as number[]

  return (
    <Form.List
      name={name}
      rules={[
        {
          validator: async (_, list: Owner[]) => {
            if (!list?.length) throw new Error(tx('কমপক্ষে একজন মালিক দিন'))
            const t = list.reduce((s, o) => s + (Number(o?.share_percent) || 0), 0)
            if (Math.abs(t - 100) > 0.001) throw new Error(tx('মালিকদের অংশের যোগফল ১০০% হতে হবে (এখন {{p0}}%)', { p0: digits(Number(t.toFixed(2))) }))
          },
        },
      ]}
    >
      {(fields, { add, remove }, { errors }) => (
        <>
          {fields.map((f, i) => (
            <Row key={f.key} gutter={8} align="top">
              <Col flex="auto">
                <Form.Item name={[f.name, 'farmer_id']} rules={[{ required: true, message: tx('মালিক বাছাই করুন') }]} label={i === 0 ? tx('মালিক') : undefined}>
                  <FarmerPicker initialLabel={owners[i]?.label} exclude={chosen.filter((id) => id !== owners[i]?.farmer_id)} />
                </Form.Item>
              </Col>
              <Col style={{ width: 120 }}>
                <Form.Item name={[f.name, 'share_percent']} rules={[{ required: true, message: tx('অংশ') }]} label={i === 0 ? tx('অংশ %') : undefined}>
                  <InputNumber min={0.01} max={100} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col style={{ width: 24, paddingTop: i === 0 ? 36 : 6 }}>
                {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} aria-label={tx('মালিক সরান')} />}
              </Col>
            </Row>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ share_percent: Math.max(0, Number((100 - total).toFixed(2))) || undefined })}>
            {tx('মালিক যোগ করুন')}
          </Button>{' '}
          <Tag color={Math.abs(total - 100) < 0.001 ? 'green' : 'red'}>{tx('মোট')}{' '}{digits(Number(total.toFixed(2)))}%</Tag>
          <Form.ErrorList errors={errors} />
        </>
      )}
    </Form.List>
  )
}
