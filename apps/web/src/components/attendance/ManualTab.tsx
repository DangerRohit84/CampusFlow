import { useState } from 'react'
import { Plus, Trash2, CalendarCheck, CheckCircle, AlertCircle } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { attendanceAPI } from '../../lib/api'

interface AttendanceRow {
  id: string
  date: string
  subject: string
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
}

const STATUS_OPTIONS = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const

const STATUS_STYLES: Record<string, string> = {
  PRESENT: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
  ABSENT: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  LATE: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  EXCUSED: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function ManualTab() {
  const [rows, setRows] = useState<AttendanceRow[]>([
    { id: '1', date: todayStr(), subject: '', status: 'PRESENT' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const addRow = () => {
    setRows([
      ...rows,
      {
        id: Date.now().toString(),
        date: todayStr(),
        subject: '',
        status: 'PRESENT',
      },
    ])
  }

  const removeRow = (id: string) => {
    if (rows.length === 1) return
    setRows(rows.filter((r) => r.id !== id))
  }

  const updateRow = (id: string, field: keyof AttendanceRow, value: string) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const bulkFillToday = () => {
    const today = todayStr()
    setRows(rows.map((r) => (r.date === today ? { ...r, status: 'PRESENT' as const } : r)))
  }

  const handleSave = async () => {
    const records = rows.filter((r) => r.subject.trim()).map((r) => ({
      subject: r.subject,
      date: r.date,
      status: r.status,
    }))

    if (!records.length) {
      setError('Add at least one row with a subject name before saving.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await attendanceAPI.save(records, 'MANUAL')
      setSuccess(`${records.length} record(s) saved successfully!`)
      setRows([{ id: Date.now().toString(), date: todayStr(), subject: '', status: 'PRESENT' }])
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save records')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800">
          <AlertCircle className="w-4 h-4 text-danger-500 shrink-0" />
          <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
          <CheckCircle className="w-4 h-4 text-primary-500 shrink-0" />
          <p className="text-sm text-primary-600 dark:text-primary-400">{success}</p>
        </div>
      )}

      <Card padding="none" className="dark:bg-[#111920] dark:border-[#202C35]">
        <div className="p-6 pb-3">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h3 className="font-bold text-surface-900 dark:text-[#F4F7F8]">Attendance Records</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={addRow} icon={<Plus size={16} />}>
                Add Row
              </Button>
              <Button variant="secondary" size="sm" onClick={bulkFillToday} icon={<CalendarCheck size={16} />}>
                All Present Today
              </Button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-b border-surface-100 dark:border-[#202C35] bg-surface-50 dark:bg-[#0C1218]">
                <th className="text-left px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Date</th>
                <th className="text-left px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Subject</th>
                <th className="text-left px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Status</th>
                <th className="text-center px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-[#202C35]">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-50 dark:hover:bg-[#202C35] transition-colors">
                  <td className="px-6 py-3">
                    <input
                      type="date"
                      value={row.date}
                      onChange={(e) => updateRow(row.id, 'date', e.target.value)}
                      className="bg-transparent border-none text-sm text-surface-900 dark:text-[#F4F7F8] focus:outline-none focus:ring-0"
                    />
                  </td>
                  <td className="px-6 py-3">
                    <input
                      type="text"
                      value={row.subject}
                      onChange={(e) => updateRow(row.id, 'subject', e.target.value)}
                      placeholder="Subject name"
                      className="bg-transparent border-none text-sm text-surface-900 dark:text-[#F4F7F8] placeholder:text-surface-400 dark:placeholder:text-[#A6B3BE] focus:outline-none focus:ring-0 w-full"
                    />
                  </td>
                  <td className="px-6 py-3">
                    <select
                      value={row.status}
                      onChange={(e) => updateRow(row.id, 'status', e.target.value)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border-none focus:outline-none focus:ring-0 cursor-pointer ${STATUS_STYLES[row.status]}`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-center px-6 py-3">
                    <button
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" size="sm" loading={saving} onClick={handleSave} icon={<CheckCircle size={16} />}>
          Save Records
        </Button>
      </div>
    </div>
  )
}
