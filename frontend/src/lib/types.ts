export type RoleRef = { name: string; label: string | null }

export type AuthUser = {
  id: number
  name_bn: string
  name_en: string | null
  username: string
  mobile: string
  email: string | null
  photo_url: string | null
  locale: string
  must_change_password: boolean
  roles: RoleRef[]
  permissions: string[]
  is_super_admin: boolean
}

export type UserRow = {
  id: number
  name_bn: string
  name_en: string | null
  username: string
  mobile: string
  email: string | null
  is_active: boolean
  is_locked: boolean
  must_change_password: boolean
  last_login_at: string | null
  created_at: string
  photo_url: string | null
  roles: RoleRef[]
}

export type Role = {
  id: number
  name: string
  label: string | null
  description: string | null
  is_system: boolean
  users_count: number
}

export type AuditLog = {
  id: number
  user_id: number | null
  user?: { id: number; name_bn: string; username: string } | null
  module: string
  action: string
  auditable_type: string | null
  auditable_id: number | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  description: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export type ApprovalStep = {
  id: number
  step_no: number
  roles: string[]
  status: string
  acted_by: number | null
  actor?: { id: number; name_bn: string } | null
  acted_at: string | null
  remarks: string | null
}

export type ApprovalRequest = {
  id: number
  action_key: string
  module: string
  title: string
  payload: Record<string, unknown> | null
  before: Record<string, unknown> | null
  amount: string | null
  status: string
  current_step: number
  total_steps: number
  requested_by: number
  approvable_type?: string | null
  approvable_id?: number | null
  requester?: { id: number; name_bn: string; username?: string }
  steps: ApprovalStep[]
  comments?: { id: number; body: string; created_at: string; user: { id: number; name_bn: string } }[]
  created_at: string
  decided_at: string | null
  can_act?: boolean
}

export type ApprovalRule = {
  id: number
  action_key: string
  module: string
  label: string
  enabled: boolean
  steps: string[][]
  min_amount: string | null
}

export type LocationItem = {
  id: number
  name_bn: string
  name_en: string | null
  code: string | null
  is_active: boolean
  division_id?: number
  district_id?: number
  upazila_id?: number
  union_id?: number
}

export type Mouza = {
  id: number
  union_id: number
  upazila_id: number
  name_bn: string
  name_en: string | null
  jl_no: string
  is_active: boolean
  union?: { id: number; name_bn: string }
  upazila?: { id: number; name_bn: string }
  villages?: { id: number; name_bn: string }[]
}

export type Sequence = {
  id: number
  key: string
  label: string
  prefix: string
  pad_length: number
  next_value: number
  reset_yearly: boolean
  preview: string
}
