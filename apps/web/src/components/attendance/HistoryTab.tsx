import { useState, useEffect } from 'react';
import { Upload, Edit3 } from 'lucide-react';
import { attendanceAPI } from '../../lib/api';

interface HistoryItem {
  date: string;
  type: string;
  subjectCount: number;
  overallPercentage: number;
}

export default function HistoryTab() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    attendanceAPI.getHistory()
      .then((res) => setHistory(res.history))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl overflow-hidden">
      <div className="p-4 border-b border-surface-200 dark:border-[#202C35] font-semibold text-surface-900 dark:text-[#F4F7F8]">
        Past Uploads & Predictions
      </div>
      {loading ? (
        <div className="p-8 text-center text-surface-400">Loading...</div>
      ) : history.length === 0 ? (
        <div className="p-8 text-center text-surface-400">No history yet. Upload or manually enter attendance data.</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-surface-100 dark:border-[#202C35] last:border-0">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              h.type === 'UPLOAD' ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-warning-50 dark:bg-warning-900/20'
            }`}>
              {h.type === 'UPLOAD' ? <Upload className="w-4 h-4 text-primary-600" /> : <Edit3 className="w-4 h-4 text-warning-600" />}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-surface-900 dark:text-[#F4F7F8]">
                {h.type === 'UPLOAD' ? 'Portal Screenshot' : 'Manual Entry'}
              </div>
              <div className="text-xs text-surface-500">
                {new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — {h.subjectCount} subjects
              </div>
            </div>
            <div className="text-sm font-bold text-primary-600">{h.overallPercentage}%</div>
          </div>
        ))
      )}
    </div>
  );
}
