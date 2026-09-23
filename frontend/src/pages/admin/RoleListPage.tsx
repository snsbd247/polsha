import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, Modal, Space, Table, Tag, Tooltip } from 'antd'
import { CopyOutlined, DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { useRoles } from '../../lib/queries'
import { required } from '../../lib/rules'
import type { Role } from '../../lib/types'

export default function RoleListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const { data: roles, isLoading } = useRoles()
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [form] = Form.useForm()

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['roles'] })

  const openForm = (r: Role | 'new') => {
    setEditing(r)
    form.setFieldsValue(r === 'new' ? { label: '', description: '' } : r)
  }

  const save = async () => {
    const values = await form.validateFields()
    try {
      if (editing === 'new') await api.post('/roles', values)
      else await api.put(`/roles/${(editing as Role).id}`, values)
      message.success('সংরক্ষণ হয়েছে।')
      setEditing(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const duplicate = async (r: Role) => {
    try {
      await api.post(`/roles/${r.id}/duplicate`)
      message.success('কপি তৈরি হয়েছে।')
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const remove = (r: Role) =>
    modal.confirm({
      title: `"${r.label}" রোল মুছবেন?`,
      okText: 'মুছুন',
      okButtonProps: { danger: true },
      cancelText: 'না',
      onOk: async () => {
        try {
          await api.delete(`/roles/${r.id}`)
          message.success('মুছে ফেলা হয়েছে।')
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  return (
    <>
      <div className="page-header">
        <h2>রোল ও অনুমতি</h2>
        <Can perm="role.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm('new')}>
            নতুন রোল
          </Button>
        </Can>
      </div>
      <Table<Role>
        rowKey="id"
        loading={isLoading}
        dataSource={roles}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: 'রোল', dataIndex: 'label', render: (v, r) => <Space>{v ?? r.name}{r.is_system && <Tag>সিস্টেম</Tag>}</Space> },
          { title: 'বিবরণ', dataIndex: 'description' },
          { title: 'ইউজার', dataIndex: 'users_count', render: digits, width: 90 },
          {
            title: '',
            width: 200,
            render: (_, r) => (
              <Space>
                <Tooltip title="অনুমতি">
                  <Button icon={<KeyOutlined />} onClick={() => navigate(`/admin/roles/${r.id}/permissions`)} />
                </Tooltip>
                {can('role.edit') && (
                  <Tooltip title="সম্পাদনা">
                    <Button icon={<EditOutlined />} onClick={() => openForm(r)} />
                  </Tooltip>
                )}
                {can('role.create') && (
                  <Tooltip title="কপি">
                    <Button icon={<CopyOutlined />} onClick={() => duplicate(r)} />
                  </Tooltip>
                )}
                {can('role.delete') && (
                  <Tooltip title={r.is_system ? 'সিস্টেম রোল মুছা যায় না' : r.users_count ? 'এই রোলে ইউজার আছে' : 'মুছুন'}>
                    <Button danger icon={<DeleteOutlined />} disabled={r.is_system || r.users_count > 0} onClick={() => remove(r)} />
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!editing}
        title={editing === 'new' ? 'নতুন রোল' : 'রোল সম্পাদনা'}
        onCancel={() => setEditing(null)}
        onOk={save}
        okText="সংরক্ষণ"
        cancelText="বাতিল"
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="label" label="রোলের নাম" rules={[required('নাম দিন')]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="বিবরণ">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
