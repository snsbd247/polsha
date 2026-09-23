import type { Rule } from 'antd/es/form'
import { toEnDigits } from './format'
import { t as tx } from './i18n'

export const passwordRules: Rule[] = [
  { required: true, message: tx('পাসওয়ার্ড দিন') },
  { min: 8, message: tx('কমপক্ষে ৮ অক্ষর') },
  { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: tx('অন্তত একটি অক্ষর ও একটি সংখ্যা থাকতে হবে') },
]

export const mobileRules: Rule[] = [
  { required: true, message: tx('মোবাইল নম্বর দিন') },
  {
    validator: (_, v?: string) =>
      !v || /^01[3-9]\d{8}$/.test(toEnDigits(v)) ? Promise.resolve() : Promise.reject(new Error(tx('সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)'))),
  },
]

export const required = (message: string): Rule => ({ required: true, message })
