import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { CloudUploadOutlined, HistoryOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import ImportWizard, { type ImportTypeKey } from '../../components/ImportWizard'
import { t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import '../irrigation/invoice-detail.css'
import '../loans/loans.css'
import '../accounting/accounting.css'

const PAGES: Record<string, { title: string; help: string[] }> = {
  savings_opening: {
    title: tx('সঞ্চয়ের প্রারম্ভিক ইমপোর্ট'),
    help: [
      tx('প্রতি সদস্যের এক সারি: সদস্য নং (বা NID / Farmer ID) ও পুরোনো খাতার জের। একই সদস্য দুবার থাকলে দ্বিতীয়টি বাদ যাবে।'),
      tx('যার প্রারম্ভিক জের আগেই দেওয়া আছে বা হিসাব বন্ধ, তার সারি ভুল হিসেবে দেখাবে।'),
      tx('টাকায় কমা (১২,৫০০) ও বাংলা অঙ্ক চলবে।'),
    ],
  },
  share_opening: {
    title: tx('শেয়ারের প্রারম্ভিক ইমপোর্ট'),
    help: [tx('প্রতি সদস্যের এক সারি: সদস্য নং (বা NID / Farmer ID) ও জমা শেয়ার মূলধন।'), tx('যার প্রারম্ভিক জের আগেই দেওয়া আছে বা হিসাব বন্ধ, তার সারি ভুল হিসেবে দেখাবে।')],
  },
  loan_opening: {
    title: tx('ঋণের প্রারম্ভিক ইমপোর্ট'),
    help: [
      tx('চলমান প্রতিটি ঋণের এক সারি: সদস্য, ঋণের ধরন (কোড বা নাম), মূল ঋণ, বিতরণের তারিখ ও বর্তমান বকেয়া আসল।'),
      tx('সুদের হার, মেয়াদ ও কিস্তি ঋণের ধরন থেকে নেওয়া হবে; পরিশোধিত আসল পুরোনো কিস্তিগুলোতে ক্রমানুসারে বসবে।'),
      tx('যার একটি চলমান ঋণ আছে, তার নতুন সারি ভুল হিসেবে দেখাবে।'),
    ],
  },
  legacy_irrigation: {
    title: tx('পুরোনো সেচ ডেটা ইমপোর্ট'),
    help: [
      tx('জমি চেনানো: জমির কোড (L-000001), অথবা উপজেলা + মৌজা JL + খতিয়ান + দাগ। জমি আগে "জমি ইমপোর্ট" দিয়ে তুলুন।'),
      tx('মৌসুম "সেচ মৌসুম" পাতায় থাকতে হবে (নাম হুবহু)। বিলের টাকা ও আদায়কৃত টাকা দিন — বাকিটা বকেয়া হিসেবে থাকবে।'),
      tx('চাষি না দিলে জমির বর্তমান চাষিকে ধরা হবে।'),
    ],
  },
  payments: {
    title: tx('পেমেন্ট ইমপোর্ট'),
    help: [
      tx('পুরোনো হাতে লেখা রশিদ: রশিদ নং, তারিখ, টাকা এবং ইনভয়েস নং অথবা জমির কোড + মৌসুম।'),
      tx('আগে "পুরোনো সেচ ডেটা ইমপোর্ট" দিয়ে বকেয়া তুলুন, তারপর রশিদ। বকেয়ার বেশি টাকা হলে সারি ভুল দেখাবে।'),
      tx('শুধু নগদ রশিদ ইমপোর্ট হয়; একই পুরোনো রশিদ নং দুবার দেওয়া যাবে না।'),
    ],
  },
}

/** The page frame every import uses: breadcrumb, a link to the import audit, and the wizard in a box. */
export function ImportFrame({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <PageFrame
      className="id-page"
      crumbs={[{ label: tx('টুলস ও ইমপোর্ট'), to: '/imports/audit' }, { label: title }]}
      title={title}
      actions={
        <Button icon={<HistoryOutlined />} className="fm-history-btn" onClick={() => navigate('/imports/audit')}>
          {tx('ইমপোর্ট অডিট')}
        </Button>
      }
    >
      <Box icon={<CloudUploadOutlined />} title={tx('Excel/CSV থেকে ইমপোর্ট')}>
        <div className="im-body">{children}</div>
      </Box>
    </PageFrame>
  )
}

/** One of the opening-balance / legacy imports, in the import frame. */
export default function ImportTypePage({ type }: { type: ImportTypeKey }) {
  const page = PAGES[type]
  return (
    <ImportFrame title={page.title}>
      <ImportWizard key={type} type={type} help={page.help} />
    </ImportFrame>
  )
}
